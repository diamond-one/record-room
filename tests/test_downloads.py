import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from downloads import DownloadQueue

ID = 'EfoxdbsUSBM'


class DownloadTests(unittest.TestCase):
    def test_collection_folder_persists_and_existing_audio_remains_accessible(self):
        self.queue.enqueue([{'id':ID}]);self.await_state('ready')
        original=self.queue.file(ID)
        target=self.root/'record collection'
        self.queue.set_directory(str(target))
        self.assertEqual(self.queue.file(ID),original)
        self.assertEqual(self.queue.snapshot()['audioDirectory'],str(target))
        self.queue.enqueue([{'id':'abcdefghijk'}])
        deadline=time.monotonic()+3
        while time.monotonic()<deadline and not self.queue.file('abcdefghijk'):time.sleep(.01)
        self.assertTrue((target/'abcdefghijk.flac').is_file())
        self.queue.close();reopened=DownloadQueue(self.root)
        try:
            self.assertEqual(reopened.audio,target)
            self.assertEqual(reopened.file(ID),original)
            self.assertEqual(reopened.file('abcdefghijk'),target/'abcdefghijk.flac')
        finally:reopened.close()

    def test_folder_changes_reject_relative_paths_and_active_downloads(self):
        for directory in ['',None,'relative/folder','bad\x00folder']:
            with self.assertRaises(ValueError):self.queue.set_directory(directory)
        release=threading.Event();self.queue.runner=lambda _:release.wait(2)
        self.queue.enqueue([{'id':ID}]);self.await_state('downloading')
        try:
            with self.assertRaises(RuntimeError):self.queue.set_directory(str(self.root/'other'))
        finally:release.set()

    def test_desktop_data_is_separate_from_read_only_application_assets(self):
        self.queue.close();data=self.root/'user profile';queue=DownloadQueue(self.root,data_directory=data)
        try:
            queue.set_directory(str(self.root/'collection'))
            self.assertTrue((data/'settings.json').is_file())
            self.assertEqual(queue.manifest,data/'downloads.json')
            self.assertFalse((self.root/'data'/'settings.json').exists())
        finally:queue.close()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.root = Path(self.temp.name)
        self.calls = []
        def fake_runner(key):
            self.calls.append(key)
            (self.queue.audio / (key+'.flac')).write_bytes(b'test completed audio')
        self.queue = DownloadQueue(self.root, runner=fake_runner)
        self.queue.tools = lambda: {'ready': True}

    def tearDown(self):
        self.queue.close()
        self.temp.cleanup()

    def await_state(self, state):
        deadline=time.monotonic()+3
        while time.monotonic()<deadline:
            jobs=self.queue.snapshot()['jobs']
            if jobs and jobs[0]['state']==state:return jobs[0]
            time.sleep(.01)
        self.fail(f'Did not reach {state}: {self.queue.snapshot()}')

    def test_completed_audio_is_persistent_and_not_downloaded_twice(self):
        self.queue.enqueue([{'id':ID,'title':'A record'}])
        self.await_state('ready')
        self.queue.enqueue([{'id':ID,'title':'A record'}])
        self.assertEqual(self.calls,[ID])
        self.queue.close()
        reopened=DownloadQueue(self.root)
        try:self.assertEqual(reopened.snapshot()['jobs'][0]['state'],'ready')
        finally:reopened.close()

    def test_bad_ids_do_not_create_jobs_or_reach_subprocess(self):
        for value in ['https://example.com/a','../anything','a;whoami','a'*12,None]:
            with self.subTest(value=value),self.assertRaises(ValueError):
                self.queue.enqueue([{'id':value}])
        self.assertEqual(self.calls,[])
        self.assertEqual(self.queue.snapshot()['jobs'],[])
        self.assertIsNone(self.queue.file('../anything'))

    def test_failed_job_can_be_retried_and_duplicate_queue_is_deduplicated(self):
        self.queue.runner=lambda _: (_ for _ in ()).throw(RuntimeError('Uploader unavailable'))
        self.queue.enqueue([{'id':ID}])
        self.assertIn('Uploader unavailable',self.await_state('failed')['error'])
        def succeed(key):(self.queue.audio/(key+'.flac')).write_bytes(b'audio')
        self.queue.runner=succeed
        self.queue.enqueue([{'id':ID},{'id':ID}])
        self.await_state('ready')
        self.assertEqual(len(self.queue.snapshot()['jobs']),1)

    def test_partial_output_is_not_considered_ready(self):
        stage=self.queue.audio/'.work'/ID
        stage.mkdir(parents=True)
        (stage/(ID+'.flac')).write_bytes(b'incomplete')
        self.assertIsNone(self.queue.file(ID))

    def test_command_has_fixed_source_staging_and_no_user_options(self):
        args=self.queue.command(ID)
        self.assertEqual(args[-2:],['--','https://www.youtube.com/watch?v='+ID])
        self.assertIn('--ignore-config',args)
        self.assertIn('--no-plugin-dirs',args)
        self.assertIn('--no-playlist',args)
        self.assertIn('.work',args[args.index('-o')+1])

    def test_cancel_queued_and_running_items_without_touching_completed_audio(self):
        release=threading.Event()
        self.queue.runner=lambda _:release.wait(2)
        self.queue.enqueue([{'id':ID},{'id':'abcdefghijk'}])
        self.await_state('downloading')
        self.queue.cancel([ID,'abcdefghijk'])
        release.set()
        self.assertTrue(all(j['state']=='cancelled' for j in self.queue.snapshot()['jobs']))

    def test_known_unavailable_failure_becomes_a_persistent_exclusion_on_reopening(self):
        self.queue.close()
        self.queue.manifest.parent.mkdir(parents=True,exist_ok=True)
        self.queue.manifest.write_text(json.dumps({ID:{'title':'A','state':'failed','error':'Video unavailable'}}))
        reopened=DownloadQueue(self.root)
        try:
            self.assertEqual(reopened.snapshot()['jobs'],[])
            self.assertIn(ID,reopened.snapshot()['excludedIds'])
            self.assertEqual(reopened.jobs[ID]['error'],'Video unavailable')
            self.assertEqual(reopened.snapshot()['audioDirectory'],str(self.root/'data'/'audio'))
        finally:reopened.close()

    def test_interrupted_jobs_return_as_retryable_failures(self):
        self.queue.close()
        self.queue.manifest.parent.mkdir(parents=True,exist_ok=True)
        self.queue.manifest.write_text(json.dumps({ID:{'title':'A','state':'downloading'}}))
        reopened=DownloadQueue(self.root)
        try:self.assertIn('Interrupted',reopened.snapshot()['jobs'][0]['error'])
        finally:reopened.close()

    def test_windows_manifest_lock_is_retried_without_losing_the_worker(self):
        original=Path.replace
        attempts=[]
        def temporarily_locked(source,target):
            attempts.append(source)
            if len(attempts)<3:raise PermissionError('File is locked by sync')
            return original(source,target)
        with patch.object(Path,'replace',autospec=True,side_effect=temporarily_locked):
            self.queue.enqueue([{'id':ID}])
            self.await_state('ready')
        self.assertTrue(self.queue.worker.is_alive())
        self.assertFalse(self.queue.snapshot()['storageError'])

    def test_persistent_manifest_error_is_visible_and_worker_survives(self):
        with patch.object(Path,'replace',side_effect=PermissionError('Locked')),patch('downloads.time.sleep'):
            self.queue.enqueue([{'id':ID}])
            self.await_state('ready')
            self.assertIn('could not be saved',self.queue.snapshot()['storageError'])
            self.assertTrue(self.queue.worker.is_alive())


if __name__=='__main__':unittest.main()
