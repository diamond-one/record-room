"""Permanent local exclusions for confirmed deleted, private or unavailable uploads."""
import json
from pathlib import Path
import re
import threading

VIDEO = re.compile(r'^[A-Za-z0-9_-]{11}$')
UNAVAILABLE = re.compile(r'video (?:is )?unavailable|private video|video has been removed|video (?:has been )?deleted', re.I)


class ExcludedRecords:
    def __init__(self, data):
        self.path = Path(data) / 'excluded-records.json'
        self.lock = threading.RLock()
        try:
            saved = json.loads(self.path.read_text(encoding='utf-8'))
            self.ids = {value for value in saved if isinstance(value, str) and VIDEO.fullmatch(value)}
        except (OSError, ValueError, TypeError):
            self.ids = set()

    def add(self, ids):
        if not isinstance(ids, list) or len(ids) > 10000 or any(not isinstance(i, str) or not VIDEO.fullmatch(i) for i in ids):
            raise ValueError('Choose valid unavailable record IDs.')
        with self.lock:
            changed = self.ids | set(ids)
            if changed != self.ids:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                staged = self.path.with_suffix('.tmp')
                staged.write_text(json.dumps(sorted(changed)), encoding='utf-8')
                staged.replace(self.path)
                self.ids = changed
            return sorted(self.ids)

    def snapshot(self):
        with self.lock:
            return sorted(self.ids)

    def filter(self, records):
        blocked = set(self.snapshot())
        return [record for record in records if record.get('youtubeId', record.get('id')) not in blocked]
