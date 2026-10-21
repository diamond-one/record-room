"""Explicit, persistent audio download queue. Only validated YouTube IDs reach yt-dlp."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import time
from exclusions import ExcludedRecords, UNAVAILABLE

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
ACTIVE = {"queued", "downloading", "converting"}


class DownloadQueue:
    def __init__(self, root: Path, runner=None, *, data_directory=None, exclusions=None):
        self.root = Path(root).resolve()
        self.data = Path(data_directory).resolve() if data_directory else self.root / 'data'
        self.settings = self.data / 'settings.json'
        self.exclusions = exclusions or ExcludedRecords(self.data)
        try:
            saved_settings = json.loads(self.settings.read_text(encoding='utf-8'))
            configured = saved_settings.get('audioDirectory')
            self.audio = Path(configured).resolve() if isinstance(configured,str) and Path(configured).is_absolute() else self.data / 'audio'
        except (OSError,ValueError,TypeError):
            self.audio = self.data / 'audio'
        self.manifest = self.data / "downloads.json"
        self.lock = threading.RLock()
        self.wake = threading.Event()
        self.closed = threading.Event()
        self.jobs = {}
        self.storage_error = ''
        self.process = None
        self.runner = runner or self._run
        try:
            saved = json.loads(self.manifest.read_text(encoding="utf-8"))
            for key, job in saved.items():
                if VIDEO_ID.fullmatch(key) and isinstance(job, dict):
                    self.jobs[key] = {'path':job.get('path','')}
                    state = "ready" if self.file(key) else "cancelled" if job.get('state') == 'cancelled' else "failed"
                    self.jobs[key] = {"id": key, "title": str(job.get("title", key))[:240],
                                      "state": state, "progress": 100 if state == "ready" else 0,
                                      "error": "" if state == "ready" else "Cancelled. You can retry later." if state == 'cancelled' else str(job.get("error") or "Download failed. Retry this record.")[:1000] if job.get("state") == "failed" else "Interrupted. Retry this download.", 'path':job.get('path','')}
        except (OSError, ValueError, AttributeError):
            pass
        self.worker = threading.Thread(target=self._work, daemon=True, name="record-audio-downloads")
        self.worker.start()

    def file(self, video_id):
        if not isinstance(video_id, str) or not VIDEO_ID.fullmatch(video_id):
            return None
        stored = self.jobs.get(video_id,{}).get('path')
        candidates = [self.audio / (video_id + '.flac')]
        if isinstance(stored,str) and stored and Path(stored).is_absolute() and Path(stored).name == video_id + '.flac':
            candidates.insert(0,Path(stored))
        for candidate in candidates:
            try:
                if candidate.is_file() and candidate.stat().st_size > 0:
                    return candidate.resolve()
            except OSError:
                continue
        return None

    def set_directory(self, directory):
        if not isinstance(directory,str) or not directory.strip() or len(directory)>4000 or '\x00' in directory:
            raise ValueError('Choose a record collection folder.')
        target=Path(directory.strip()).expanduser()
        if not target.is_absolute():
            raise ValueError('Use a full folder path.')
        target=target.resolve()
        with self.lock:
            if any(job['state'] in ACTIVE for job in self.jobs.values()) or self.process:
                raise RuntimeError('Finish or cancel pending downloads before changing the folder.')
            target.mkdir(parents=True,exist_ok=True)
            # Probe actual write access, including network and synced directories.
            import tempfile
            with tempfile.TemporaryFile(dir=target) as probe:
                probe.write(b'Record Room')
            for key,job in self.jobs.items():
                existing=self.file(key)
                if existing:job['path']=str(existing)
            self.settings.parent.mkdir(parents=True,exist_ok=True)
            staged=self.settings.with_suffix('.tmp')
            staged.write_text(json.dumps({'audioDirectory':str(target)},indent=2),encoding='utf-8')
            staged.replace(self.settings)
            self.audio=target
            self._save()
        return self.snapshot()

    def tools(self):
        bundled = self.root / "tools" / "python" / "yt_dlp" / "__main__.py"
        installed = bundled.is_file() or importlib.util.find_spec("yt_dlp") is not None
        return {"ready": bool(installed and shutil.which("ffmpeg")), "downloader": bool(installed),
                "ffmpeg": bool(shutil.which("ffmpeg")), "javascript": bool(shutil.which("node"))}

    def snapshot(self):
        with self.lock:
            blocked = self.exclusions.add([j['id'] for j in self.jobs.values() if j['state']=='failed' and UNAVAILABLE.search(j.get('error',''))])
            return {"excludedIds": blocked, "audioDirectory": str(self.audio), "tools": self.tools(), "jobs": self.exclusions.filter([dict(j) for j in self.jobs.values()]),
                    "active": sum(j["state"] in ACTIVE for j in self.jobs.values()), 'storageError': self.storage_error}

    def _save(self):
        # Windows sync/indexing tools can briefly open the manifest without delete sharing.
        for attempt in range(5):
            try:
                self.manifest.parent.mkdir(parents=True, exist_ok=True)
                temp = self.manifest.with_suffix(".tmp")
                temp.write_text(json.dumps(self.jobs, ensure_ascii=False), encoding="utf-8")
                temp.replace(self.manifest)
                self.storage_error = ''
                return
            except OSError:
                if attempt < 4:
                    time.sleep(.05 * (attempt+1))
        self.storage_error = 'Queue history could not be saved. Check folder access or sync locks; completed audio is safe.'

    def enqueue(self, records):
        if not isinstance(records, list) or not 1 <= len(records) <= 500:
            raise ValueError("Choose between 1 and 500 records.")
        clean = []
        for item in records:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not VIDEO_ID.fullmatch(item["id"]):
                raise ValueError("A record has an invalid YouTube ID.")
            if item['id'] not in self.exclusions.snapshot():
                clean.append((item["id"], str(item.get("title", item["id"]))[:240]))
        if not clean:
            return self.snapshot()
        if not self.tools()["ready"]:
            raise RuntimeError("The downloader or audio converter is missing. Reinstall Record Room, or run Setup downloads.cmd in the source version.")
        with self.lock:
            if self.closed.is_set():
                raise RuntimeError("The download queue is closing.")
            for key, title in clean:
                existing = self.jobs.get(key)
                if existing and existing["state"] in ACTIVE:
                    continue
                ready = bool(self.file(key))
                path=self.file(key)
                self.jobs[key] = {"id": key, "title": title, "state": "ready" if ready else "queued",
                                  "progress": 100 if ready else 0, "error": "", 'path':str(path) if path else ''}
            self._save()
        self.wake.set()
        return self.snapshot()

    def cancel(self, ids):
        if not isinstance(ids, list) or any(not isinstance(i, str) or not VIDEO_ID.fullmatch(i) for i in ids):
            raise ValueError("Choose valid records to cancel.")
        process = None
        with self.lock:
            for key in ids:
                job = self.jobs.get(key)
                if job and job["state"] in ACTIVE:
                    was_running = job["state"] != "queued"
                    job.update(state="cancelled", error="Cancelled. You can retry later.")
                    if was_running and self.process:
                        process = self.process
            self._save()
        if process:
            self._terminate(process)
        return self.snapshot()

    @staticmethod
    def _terminate(process):
        if process.poll() is not None:
            return
        if os.name == 'nt':
            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           creationflags=subprocess.CREATE_NO_WINDOW, timeout=10)
        else:
            process.terminate()

    def _work(self):
        while not self.closed.is_set():
            self.wake.wait(.5)
            self.wake.clear()
            while not self.closed.is_set():
                with self.lock:
                    job = next((j for j in self.jobs.values() if j["state"] == "queued"), None)
                    if job is None:
                        break
                    key = job["id"]
                    job.update(state="downloading", progress=0, error="")
                    self._save()
                try:
                    self.audio.mkdir(parents=True, exist_ok=True)
                    if shutil.disk_usage(self.audio).free < 768 * 1024**2:
                        raise RuntimeError("Less than 768 MB free. Free some disk space and retry.")
                    self.runner(key)
                    with self.lock:
                        if job["state"] != "cancelled":
                            if not self.file(key):
                                raise RuntimeError("No playable audio was produced. Retry or attach a local file.")
                            job.update(state="ready", progress=100, error="",path=str(self.file(key)))
                except Exception as error:
                    with self.lock:
                        if job["state"] != "cancelled":
                            job.update(state="failed", error=str(error)[-650:])
                finally:
                    with self.lock:
                        self.process = None
                        self._save()

    def command(self, key):
        if not VIDEO_ID.fullmatch(key):
            raise ValueError("Invalid YouTube ID.")
        launcher=[sys.executable,'--download-worker'] if getattr(sys,'frozen',False) else [sys.executable,'-m','yt_dlp']
        command = launcher + ["--ignore-config", "--no-plugin-dirs",
                   "--no-playlist", "--no-colors", "--newline", "--socket-timeout", "25",
                   "--retries", "2", "--fragment-retries", "2", "--max-filesize", "512M",
                   "--match-filter", "!is_live & duration <= 7200", "-f", "bestaudio/best", "-x",
                   "--audio-format", "flac", "--no-keep-video", "--progress-template",
                   "download:RR_PROGRESS:%(progress._percent_str)s", "--force-overwrites", "-o",
                   str(self.audio / ".work" / key / (key + ".%(ext)s"))]
        if shutil.which("node"):
            command += ["--js-runtimes", "node:" + shutil.which("node")]
        command += ["--", "https://www.youtube.com/watch?v=" + key]
        return command

    def _run(self, key):
        environment = dict(os.environ)
        bundle = self.root / "tools" / "python"
        if bundle.is_dir():
            environment["PYTHONPATH"] = str(bundle) + os.pathsep + environment.get("PYTHONPATH", "")
        environment["PYTHONIOENCODING"] = "utf-8"
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        with self.lock:
            if self.closed.is_set() or self.jobs[key]["state"] == "cancelled":
                return
            process = subprocess.Popen(self.command(key), cwd=self.root, env=environment, shell=False,
                                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                       encoding="utf-8", errors="replace", creationflags=flags)
            self.process = process
        timed_out = threading.Event()
        def timeout():
            timed_out.set()
            try:
                self._terminate(process)
            except OSError:
                pass
        timer = threading.Timer(1800, timeout)
        timer.daemon = True
        timer.start()
        errors = []
        try:
            for line in process.stdout:
                line = line.strip()
                with self.lock:
                    job = self.jobs[key]
                    if job["state"] == "cancelled" or self.closed.is_set():
                        self._terminate(process)
                        break
                    match = re.search(r"RR_PROGRESS:\s*([\d.]+)%", line)
                    if match:
                        job["progress"] = min(99, max(0, float(match[1])))
                    if "[ExtractAudio]" in line:
                        job["state"] = "converting"
                if "ERROR:" in line:
                    errors.append(line.replace("ERROR:", "").strip())
            code = process.wait(timeout=15)
            if timed_out.is_set():
                raise RuntimeError("Download timed out. Retry when the connection is stable.")
            if code:
                raise RuntimeError(errors[-1] if errors else "The download failed. Retry, open its source, or attach local audio.")
            staged = self.audio / ".work" / key / (key + ".flac")
            with self.lock:
                if self.jobs[key]["state"] != "cancelled" and not self.closed.is_set() and staged.is_file():
                    staged.replace(self.audio / (key + ".flac"))
        finally:
            timer.cancel()
            if process.poll() is None:
                self._terminate(process)
            process.stdout.close()

    def close(self):
        self.closed.set()
        self.wake.set()
        with self.lock:
            process = self.process
        if process:
            self._terminate(process)
        self.worker.join(timeout=3)
