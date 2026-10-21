"""Checks for the local MIDI boundary; no hardware is opened by these tests."""

import http.client
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / "server.py"
SPEC = importlib.util.spec_from_file_location("record_room_server", MODULE_PATH)
server_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(server_module)


class FakeMidi:
    def __init__(self):
        self.port = None
        self.calls = []
        self.closed = False

    def ports(self):
        return {"available": True, "ports": [{"id": 2, "name": "USB Midi 1"}]}

    def status(self):
        return {"connected": self.port is not None, "port": self.port,
                "name": "USB Midi 1" if self.port is not None else None, "error": None}

    def connect(self, port):
        if port not in (None, 2):
            raise ValueError("Input not available")
        self.calls.append(port)
        self.port = port
        return self.status()

    def close(self):
        self.closed = True


class MessageTests(unittest.TestCase):
    def test_cc_keeps_channel_and_full_range(self):
        self.assertEqual(server_module.decode_short_message(0x7F10B2), [0xB2, 16, 127])

    def test_pad_press_release_and_note_on_zero_survive_the_bridge(self):
        self.assertEqual(server_module.decode_short_message((100 << 16) | (36 << 8) | 0x93), [0x93, 36, 100])
        self.assertEqual(server_module.decode_short_message((64 << 16) | (36 << 8) | 0x83), [0x83, 36, 64])
        self.assertEqual(server_module.decode_short_message((36 << 8) | 0x93), [0x93, 36, 0])

    def test_pitchbend_preserves_both_data_bytes(self):
        self.assertEqual(server_module.decode_short_message(0x4000E0), [0xE0, 0, 64])

    def test_program_change_discards_unused_third_byte(self):
        self.assertEqual(server_module.decode_short_message(0xFF05C0), [0xC0, 5, 0])

    def test_sysex_running_status_and_invalid_data_are_rejected(self):
        for packed in (0x1234F0, 0xF7, 0x45, 0xFF10B0, 0x01FF90):
            with self.subTest(packed=packed):
                self.assertIsNone(server_module.decode_short_message(packed))

    def test_hub_drops_oldest_without_blocking(self):
        hub = server_module.EventHub(capacity=2)
        subscriber = hub.subscribe()
        for number in range(3):
            hub.publish({"number": number})
        self.assertEqual(subscriber.get_nowait(), {"number": 1})
        self.assertEqual(subscriber.get_nowait(), {"number": 2})
        hub.close()
        self.assertIsNone(subscriber.get_nowait())


class ServerTests(unittest.TestCase):
    def test_unavailable_records_are_excluded_from_discovery_and_channel_previews(self):
        identifier='ItXxsxlSrQQ'
        self.server.discovery.records[identifier]={'youtubeId':identifier,'title':'Southern Man'}
        try:
            self.assertEqual(self.request('POST','/api/collection/exclusions',json.dumps({'ids':[identifier]}),{'Content-Type':'application/json','Origin':'https://evil.test'})[0],403)
            response=self.request('POST','/api/collection/exclusions',json.dumps({'ids':[identifier]}),{'Content-Type':'application/json','Origin':self.origin})
            self.assertEqual(response[0],200)
            result=json.loads(self.request('GET','/api/discovery')[2])
            self.assertNotIn(identifier,[r['youtubeId'] for r in result['records']])
            self.assertIn(identifier,result['excludedIds'])
            self.assertEqual(self.request('GET','/data/excluded-records.json')[0],403)
        finally:self.server.discovery.records.pop(identifier,None)

    def test_collection_folder_api_validates_and_persists_without_exposing_settings(self):
        folder=self.server.root/'record collection'
        def change(value):return self.request('POST','/api/downloads/directory',json.dumps({'directory':value}),{'Content-Type':'application/json','Origin':self.origin})
        self.assertEqual(change('relative')[0],400)
        self.assertEqual(self.request('POST','/api/downloads/directory',json.dumps({'directory':str(folder)}),{'Content-Type':'application/json','Origin':'https://evil.test'})[0],403)
        original=self.server.downloads.audio
        try:
            response=change(str(folder));self.assertEqual(response[0],200)
            self.assertEqual(json.loads(response[2])['audioDirectory'],str(folder))
            self.assertEqual(self.request('GET','/data/settings.json')[0],403)
        finally:change(str(original))

    def test_source_manager_rejects_non_channel_urls_and_unknown_sources(self):
        headers={'Content-Type':'application/json','Origin':self.origin}
        response=self.request('POST','/api/discovery/add',json.dumps({'url':'https://evil.test/@source'}),headers)
        self.assertEqual(response[0],400)
        self.assertEqual(self.request('GET','/api/discovery/preview?key=missing')[0],404)
        self.assertEqual(self.request('POST','/api/discovery/remove',json.dumps({'key':'missing'}),headers)[0],400)

    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(dir=MODULE_PATH.parent)
        root = Path(cls.temporary.name)
        (root / "index.html").write_text("<title>Record Room</title>", encoding="utf-8")
        cls.midi = FakeMidi()
        cls.server = server_module.RecordRoomServer(("127.0.0.1", 0), root, cls.midi)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        cls.temporary.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        result = (response.status, dict(response.getheaders()), response.read())
        connection.close()
        return result

    def test_discovery_snapshot_is_read_only_and_empty_sources_start_no_network_work(self):
        status, _, body = self.request('GET', '/api/discovery')
        self.assertEqual(status, 200)
        snapshot = json.loads(body)
        self.assertEqual(snapshot['total'], 0)
        self.assertFalse(snapshot['running'])
        self.assertEqual(snapshot['records'], [])
        status, _, body = self.request('POST', '/api/discovery/refresh', '{}',
            {'Origin':self.origin,'Content-Type':'application/json'})
        self.assertEqual(status, 200)
        self.assertFalse(json.loads(body)['running'])

    def test_channel_import_rejects_external_urls_and_cross_origin_requests(self):
        payload = json.dumps({'channels':[{'name':'bad','youtube_url':'https://localhost/@example'}]})
        status, _, _ = self.request('POST','/api/discovery/channels',payload,
            {'Origin':self.origin,'Content-Type':'application/json'})
        self.assertEqual(status, 400)
        status, _, _ = self.request('POST','/api/discovery/refresh','{}',
            {'Origin':'https://unrelated.test','Content-Type':'application/json'})
        self.assertEqual(status, 403)

    def post(self, payload, origin=None):
        return self.request("POST", "/api/midi/connect", json.dumps(payload), {
            "Content-Type": "application/json", "Origin": origin or self.origin,
        })

    def test_ports_and_status_do_not_open_input(self):
        before = list(self.midi.calls)
        status, headers, body = self.request("GET", "/api/midi/ports")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["ports"], [{"id": 2, "name": "USB Midi 1"}])
        self.request("GET", "/api/midi/status")
        self.assertEqual(self.midi.calls, before)
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_connect_and_disconnect(self):
        status, _, body = self.post({"id": 2})
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["connected"])
        status, _, body = self.post({"id": None})
        self.assertEqual(status, 200)
        self.assertFalse(json.loads(body)["connected"])

    def test_foreign_and_missing_origin_cannot_connect(self):
        before = list(self.midi.calls)
        for origin in ("https://untrusted.example", "null", "http://localhost:8770"):
            self.assertEqual(self.post({"id": 2}, origin)[0], 403)
        self.assertEqual(self.request("POST", "/api/midi/connect", '{"id":2}', {
            "Content-Type": "application/json",
        })[0], 403)
        self.assertEqual(self.midi.calls, before)

    def test_dns_rebinding_host_is_rejected(self):
        self.assertEqual(self.request("GET", "/api/midi/ports", headers={"Host": "untrusted.example"})[0], 403)

    def test_malformed_and_ambiguous_body_is_rejected(self):
        for payload in ({}, {"id": True}, {"id": -1}, {"id": "2"}, {"id": 2.0}, [], {"id": 2, "send": True}):
            with self.subTest(payload=payload):
                self.assertEqual(self.post(payload)[0], 400)
        self.assertEqual(self.request("POST", "/api/midi/connect", "{broken", {
            "Content-Type": "application/json", "Origin": self.origin,
        })[0], 400)
        self.assertEqual(self.request("POST", "/api/midi/connect", "id=2", {
            "Content-Type": "application/x-www-form-urlencoded", "Origin": self.origin,
        })[0], 415)

    def test_unknown_port_and_route(self):
        self.assertEqual(self.post({"id": 99})[0], 400)
        self.assertEqual(self.request("GET", "/api/not-real")[0], 404)

    def test_downloads_require_same_origin_and_reject_arbitrary_sources(self):
        body=json.dumps({'records':[{'id':'https://untrusted.example/a'}]})
        self.assertEqual(self.request('POST','/api/downloads',body,{'Content-Type':'application/json'})[0],403)
        status,_,_=self.request('POST','/api/downloads',body,{'Content-Type':'application/json','Origin':self.origin})
        self.assertEqual(status,400)
        self.assertEqual(self.request('GET','/api/downloads')[0],200)

    def test_every_browser_module_in_the_app_is_deliverable(self):
        for module in MODULE_PATH.parent.glob('*.js'):
            with self.subTest(module=module.name):
                (self.server.root/module.name).write_text('// browser module',encoding='utf-8')
                self.assertEqual(self.request('GET','/'+module.name)[0],200)

    def test_audio_endpoint_serves_only_valid_completed_cache_files(self):
        audio=self.server.downloads.audio
        audio.mkdir(parents=True,exist_ok=True)
        target=audio/'abcdefghijk.flac'
        target.write_bytes(b'completed')
        status,headers,body=self.request('GET','/api/audio/abcdefghijk')
        self.assertEqual((status,body),(200,b'completed'))
        self.assertEqual(headers['Content-Type'],'audio/flac')
        for path in ('/api/audio/../../index.html','/api/audio/invalid','/data/audio/abcdefghijk.flac','/.impeccable/references/anything.png','/tools/python/anything.py','/DIRECTION.md','/downloads.py'):
            self.assertIn(self.request('GET',path)[0],(403,404))

    def test_static_file_and_traversal(self):
        status, _, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"Record Room", body)
        for path in ("/../outside.txt", "/%2e%2e/outside.txt", "/..%5coutside.txt"):
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path)[0], 403)

    def test_sse_broadcasts_short_message(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        connection.request("GET", "/api/midi/events")
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        self.assertEqual(response.headers["Content-Type"], "text/event-stream; charset=utf-8")
        self.assertTrue(response.readline().startswith(b":"))
        self.assertEqual(response.readline(), b"\n")
        event = {"data": [176, 16, 99], "port": 2, "time": 123.5}
        self.server.hub.publish(event)
        self.assertEqual(json.loads(response.readline().decode()[6:]), event)
        response.close()
        connection.close()

    def test_public_bind_is_rejected(self):
        with self.assertRaises(ValueError):
            server_module.RecordRoomServer(("0.0.0.0", 0))


if __name__ == "__main__":
    unittest.main()
