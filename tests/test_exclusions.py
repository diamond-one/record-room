import json
from pathlib import Path
import tempfile
import unittest
from exclusions import ExcludedRecords, UNAVAILABLE
from downloads import DownloadQueue


class ExclusionTests(unittest.TestCase):
    def test_exclusion_survives_restart_and_filters_reimported_records(self):
        with tempfile.TemporaryDirectory() as folder:
            store=ExcludedRecords(folder)
            store.add(['ItXxsxlSrQQ'])
            reopened=ExcludedRecords(folder)
            self.assertEqual(reopened.filter([{'youtubeId':'ItXxsxlSrQQ'},{'id':'abcdefghijk'}]),[{'id':'abcdefghijk'}])
            self.assertEqual(reopened.add(['ItXxsxlSrQQ']),['ItXxsxlSrQQ'])

    def test_transient_and_embedding_errors_are_not_permanent_exclusions(self):
        for error in ['HTTP Error 403: Forbidden','Connection timed out','Sign in to confirm your age','Embedding disabled','Uploader unavailable']:
            self.assertIsNone(UNAVAILABLE.search(error))
        for error in ['Video unavailable','This video is unavailable','Private video','This video has been removed','Video deleted']:
            self.assertIsNotNone(UNAVAILABLE.search(error))

    def test_known_unavailable_download_is_removed_and_cannot_be_requeued(self):
        with tempfile.TemporaryDirectory() as folder:
            data=Path(folder)/'data';data.mkdir()
            (data/'downloads.json').write_text(json.dumps({'ItXxsxlSrQQ':{'state':'failed','error':'Video unavailable','title':'Southern Man'}}))
            queue=DownloadQueue(Path(folder))
            try:
                self.assertEqual(queue.snapshot()['jobs'],[])
                self.assertEqual(queue.snapshot()['excludedIds'],['ItXxsxlSrQQ'])
                self.assertEqual(queue.enqueue([{'id':'ItXxsxlSrQQ'}])['jobs'],[])
            finally:queue.close()

    def test_invalid_ids_do_not_change_persistent_exclusions(self):
        with tempfile.TemporaryDirectory() as folder:
            store=ExcludedRecords(folder)
            for ids in ['abcdefghijk',['../anything'],[None]]:
                with self.assertRaises(ValueError):store.add(ids)
            self.assertEqual(store.snapshot(),[])
