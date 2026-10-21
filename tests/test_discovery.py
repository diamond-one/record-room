import json
from pathlib import Path
import tempfile
import threading
import time
import unittest

from discovery import ChannelLibrary, channel_url, normalize_channels, read_channel, record_year

CHANNEL_ID = 'UC' + 'a' * 22
SEED = {'name': 'Test Collector', 'youtube_url': 'https://www.youtube.com/channel/' + CHANNEL_ID, 'genres': ['Soul', 'Jazz']}


def feed(identifier=CHANNEL_ID[2:]):
    return f'''<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
    <yt:channelId>{identifier}</yt:channelId><title>Actual Collector</title>
    <entry><yt:videoId>abcdefghijk</yt:videoId><title>Singer – A Record 1973</title><published>2026-10-20</published></entry>
    <entry><yt:videoId>12345678901</yt:videoId><title>Another song</title><published>2026-10-20</published></entry>
    <entry><yt:videoId>invalid</yt:videoId><title>Bad ID</title></entry>
    <entry><yt:videoId>live1234567</yt:videoId><title>Live stream 24/7</title></entry></feed>'''


class DiscoveryTests(unittest.TestCase):
    def test_source_remove_undo_preview_and_empty_collection_persist(self):
        with tempfile.TemporaryDirectory() as temp:
            library=ChannelLibrary(Path(temp),reader=lambda c:read_channel(c,fetch=lambda _:feed()))
            try:
                library.import_channels([SEED],refresh=False)
                resolved=read_channel(library.channels[0],fetch=lambda _:feed())
                library.states[CHANNEL_ID]={'status':'ready','channel_id':CHANNEL_ID,'count':len(resolved['records'])}
                library.records={r['youtubeId']:r for r in resolved['records']}
                self.assertEqual(len(library.preview(CHANNEL_ID)['records']),2)
                library.remove_channel(CHANNEL_ID)
                self.assertEqual(library.snapshot()['total'],0);self.assertEqual(library.snapshot()['recordCount'],0)
                self.assertEqual(normalize_channels(json.loads(library.seeds.read_text())),[])
                self.assertTrue(library.snapshot()['canUndo'])
                library.undo_remove();self.assertEqual(library.snapshot()['recordCount'],2)
                self.assertFalse(library.snapshot()['canUndo'])
                with self.assertRaises(ValueError):library.preview('missing')
                with self.assertRaises(ValueError):library.add_channel({'url':SEED['youtube_url']})
            finally:library.close()

    def test_removed_channel_in_flight_cannot_repopulate_the_discovery_pool(self):
        started=threading.Event();release=threading.Event()
        def reader(channel):
            started.set();release.wait(3);return read_channel(channel,fetch=lambda _:feed())
        with tempfile.TemporaryDirectory() as temp:
            library=ChannelLibrary(Path(temp),reader=reader)
            try:
                library.import_channels([SEED]);self.assertTrue(started.wait(2))
                library.remove_channel(CHANNEL_ID);release.set()
                deadline=time.monotonic()+3
                while library.running and time.monotonic()<deadline:time.sleep(.01)
                self.assertEqual(library.snapshot()['total'],0)
                self.assertEqual(library.snapshot()['records'],[])
                self.assertNotIn(CHANNEL_ID,library.states)
            finally:release.set();library.close()

    def test_single_source_add_and_edit_are_persistent_and_validate_addresses(self):
        with tempfile.TemporaryDirectory() as temp:
            library=ChannelLibrary(Path(temp),reader=lambda c:read_channel(c,fetch=lambda _:feed()))
            try:
                with self.assertRaises(ValueError):library.add_channel({'url':'https://evil.test/@x'})
                library.add_channel({'url':SEED['youtube_url'],'name':'Collector','genres':['Soul']})
                deadline=time.monotonic()+3
                while library.running and time.monotonic()<deadline:time.sleep(.01)
                self.assertEqual(library.snapshot()['working'],1)
                library.add_channel({'url':SEED['youtube_url'],'replaceKey':CHANNEL_ID,'genres':['Jazz']})
                self.assertEqual(library.preview(CHANNEL_ID)['records'][0]['genres'],['Jazz'])
                self.assertEqual(json.loads(library.seeds.read_text())['channels'][0]['genres'],['Jazz'])
            finally:library.close()
    def test_only_supported_youtube_channel_addresses_are_accepted(self):
        for url in ['http://www.youtube.com/@name', 'https://youtube.com.evil.test/@name',
                    'https://localhost/@name', 'https://www.youtube.com/watch?v=abcdefghijk',
                    'https://www.youtube.com/@name?redirect=evil', 'https://u:p@www.youtube.com/@name',
                    'https://www.youtube.com:443/@name', 'https://www.youtube.com/@name/videos']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                channel_url(url)
        self.assertEqual(channel_url('https://youtube.com/@collector/'), 'https://www.youtube.com/@collector')

    def test_channel_list_deduplicates_and_rejects_conflicting_ids_or_malformed_genres(self):
        self.assertEqual(len(normalize_channels({'channels': [SEED, SEED]})), 1)
        with self.assertRaises(ValueError):
            normalize_channels({'channels': [dict(SEED, channel_id='UC'+'b'*22)]})
        with self.assertRaises(ValueError):
            normalize_channels({'channels': [dict(SEED, genres='Soul')]})

    def test_feed_validation_supports_youtube_root_ids_with_or_without_uc_prefix(self):
        for identifier in (CHANNEL_ID, CHANNEL_ID[2:]):
            result = read_channel(normalize_channels([SEED])[0], lambda url: feed(identifier))
            self.assertEqual(result['channel_id'], CHANNEL_ID)
            self.assertEqual(len(result['records']), 2)
            first, second = result['records']
            self.assertEqual(first['year'], 1973)
            self.assertIsNone(second['year'])
            self.assertEqual(first['genre'], '')
            self.assertEqual(first['genres'], ['Soul', 'Jazz'])
            self.assertEqual(first['channel'], 'Actual Collector')
        with self.assertRaises(ValueError):
            read_channel(normalize_channels([SEED])[0], lambda url: feed('UC'+'b'*22))

    def test_research_schema_preserves_every_lead_and_keeps_validation_claims_as_data(self):
        data={'channels':[
            {'Channel':'Collector','Primary URL':SEED['youtube_url'],'UC Channel ID (unconfirmed)':CHANNEL_ID,
             'Genre tags':'Soul; Jazz','Category':'Rare records','Validation state':'VALIDATED',
             'Sources':'Research source','Notes':'untrusted text, retained only as data'},
            {'Channel':'Name only','Primary URL':'','Genre tags':'Gospel','Import gate':'DISCOVERY_ONLY'},
            {'Channel':'Old address','Primary URL':'https://youtube.com/oldname','Genre tags':''}]}
        channels=normalize_channels(data)
        self.assertEqual(len(channels),3)
        self.assertEqual(channels[0]['genres'],['Soul','Jazz'])
        self.assertEqual(channels[0]['research']['Validation state'],'VALIDATED')
        self.assertNotIn('checkedAt',channels[0])
        self.assertFalse(channels[1]['url'])
        self.assertEqual(channels[2]['candidate_url'],'https://youtube.com/oldname')
        self.assertFalse(channels[2]['url'])
        self.assertEqual(normalize_channels({'channels':channels}),channels)

    def test_research_aliases_merge_without_losing_names_or_genres(self):
        channels=normalize_channels([SEED,dict(SEED,name='Another spelling',genres=['Funk'])])
        self.assertEqual(len(channels),1)
        self.assertEqual(channels[0]['aliases'],['Another spelling'])
        self.assertEqual(channels[0]['genres'],['Soul','Jazz','Funk'])

    def test_expanding_the_list_preserves_cache_and_never_fetches_name_only_leads(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1]) as temporary:
            root=Path(temporary);(root/'data').mkdir()
            (root/'data/channels.json').write_text(json.dumps({'channels':[SEED]}),encoding='utf-8')
            calls=[]
            def reader(channel):
                calls.append(channel['name'])
                return read_channel(channel,lambda url:feed())
            library=ChannelLibrary(root,reader)
            library.refresh()
            deadline=time.monotonic()+5
            while library.running and time.monotonic()<deadline:time.sleep(.01)
            added={'Channel':'Pending lead','Primary URL':'','Genre tags':'Gospel'}
            state=library.import_channels({'channels':[SEED,added]},refresh=False)
            self.assertEqual((state['total'],state['pending'],state['checkable'],state['working'],state['recordCount']),(2,1,1,1,2))
            library.refresh()
            self.assertFalse(library.running)
            self.assertEqual(calls,['Test Collector'])
            library.close()
            restored=ChannelLibrary(root,reader)
            self.assertEqual(restored.snapshot()['pending'],1)
            self.assertEqual(restored.snapshot()['recordCount'],2)
            restored.close()

    def test_legacy_urls_resolve_stable_ids_before_fetching_the_feed(self):
        urls = []
        def fetch(url):
            urls.append(url)
            return feed() if '/feeds/' in url else '{"externalId":"' + CHANNEL_ID + '"}'
        result = read_channel(normalize_channels([dict(SEED, youtube_url='https://www.youtube.com/user/collector')])[0], fetch)
        self.assertEqual(result['channel_id'], CHANNEL_ID)
        self.assertEqual(len(urls), 2)

    def test_untrusted_xml_and_ambiguous_years_do_not_produce_misleading_metadata(self):
        with self.assertRaises(ValueError):
            read_channel(normalize_channels([SEED])[0], lambda url: '<!DOCTYPE feed>'+feed())
        self.assertIsNone(record_year('Recorded 1968 remastered 2020'))
        self.assertIsNone(record_year('No release year'))
        self.assertEqual(record_year('Soul LP (1978)'), 1978)

    def test_scan_is_cached_deduplicated_and_failures_do_not_block_working_sources(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1]) as temporary:
            root = Path(temporary); (root/'data').mkdir()
            bad = dict(SEED, name='Unavailable', youtube_url='https://www.youtube.com/channel/UC'+'b'*22)
            (root/'data/channels.json').write_text(json.dumps({'channels':[SEED,bad]}), encoding='utf-8')
            calls = []
            def reader(channel):
                calls.append(channel['name'])
                if channel['name']=='Unavailable': raise ValueError('missing')
                return read_channel(channel, lambda url: feed())
            library=ChannelLibrary(root, reader)
            library.refresh()
            deadline=time.monotonic()+5
            while library.running and time.monotonic()<deadline: time.sleep(.01)
            state=library.snapshot()
            self.assertFalse(state['running'])
            self.assertEqual((state['working'],state['failed'],state['recordCount']),(1,1,2))
            self.assertNotIn('records', library.snapshot(state['version']))
            library.refresh(); self.assertEqual(len(calls),2)
            library.import_channels({'channels':[SEED,bad]})
            self.assertEqual(len(calls),2)
            self.assertEqual(library.snapshot()['recordCount'],2)
            library.close()
            restored=ChannelLibrary(root,reader)
            self.assertEqual(restored.snapshot()['recordCount'],2)
            self.assertFalse(restored.snapshot()['running'])
            restored.close()

    def test_simultaneous_refreshes_share_one_scan_and_import_waits_for_it(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1]) as temporary:
            root=Path(temporary);(root/'data').mkdir()
            (root/'data/channels.json').write_text(json.dumps({'channels':[SEED]}),encoding='utf-8')
            gate=threading.Event();calls=[]
            def reader(channel):
                calls.append(1);gate.wait(2)
                return read_channel(channel,lambda url:feed())
            library=ChannelLibrary(root,reader)
            library.refresh();library.refresh()
            with self.assertRaises(RuntimeError):library.import_channels([SEED])
            gate.set()
            deadline=time.monotonic()+5
            while library.running and time.monotonic()<deadline:time.sleep(.01)
            self.assertEqual(len(calls),1)
            library.close()


if __name__ == '__main__': unittest.main()
