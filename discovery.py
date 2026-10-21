"""Cached public YouTube channel feeds. Never fetches Sample Digging or media files."""
from __future__ import annotations

import json
from pathlib import Path
import queue
import re
import threading
import time
from urllib.error import HTTPError
from urllib.parse import unquote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import xml.etree.ElementTree as ET

CHANNEL = re.compile(r"UC[A-Za-z0-9_-]{22}\Z")
VIDEO = re.compile(r"[A-Za-z0-9_-]{11}\Z")
NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}


def channel_url(value):
    if not isinstance(value, str) or len(value) > 300:
        raise ValueError("Choose a YouTube channel URL.")
    parts = urlsplit(value)
    if (parts.scheme != "https" or parts.hostname not in ("youtube.com", "www.youtube.com")
            or parts.username or parts.password or parts.port or parts.query or parts.fragment):
        raise ValueError("Only public HTTPS YouTube channel URLs are supported.")
    path = unquote(parts.path).rstrip("/")
    if not re.fullmatch(r"/(?:channel/UC[A-Za-z0-9_-]{22}|(?:user|c)/[^/\s?#\\]{1,100}|@[^/\s?#\\]{1,100})", path):
        raise ValueError("Use a channel, @handle, or legacy YouTube user URL.")
    return "https://www.youtube.com" + parts.path.rstrip("/")


def normalize_channels(data):
    rows = data.get("channels") if isinstance(data, dict) else data
    if not isinstance(rows, list) or not 0 <= len(rows) <= 2000:
        raise ValueError("Choose a channel-list JSON with up to 2,000 channels.")
    result, seen = [], {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Every channel needs a name and YouTube URL.")
        research_row = 'Channel' in row
        name = str(row.get('name') or row.get('Channel') or '').strip()[:160]
        raw_url = row.get("youtube_url") or row.get("url") or row.get('Primary URL') or ''
        candidate_url = str(row.get('candidate_url') or raw_url)[:300]
        pending_reason = ''
        if raw_url:
            try:
                url = channel_url(raw_url)
            except ValueError:
                if not research_row:
                    raise
                url, pending_reason = '', 'Address needs resolution'
        else:
            url, pending_reason = '', str(row.get('pending_reason') or 'No confirmed channel address')[:160]
        supplied = row.get("channel_id") or row.get('UC Channel ID (unconfirmed)') or None
        if supplied is not None and (not isinstance(supplied, str) or not CHANNEL.fullmatch(supplied)):
            raise ValueError("A channel ID in the list is invalid.")
        path_id = url.rsplit("/", 1)[-1] if "/channel/" in url else None
        if supplied and path_id and supplied != path_id:
            raise ValueError("A channel URL and ID disagree.")
        identifier = supplied or path_id
        if identifier and not url:
            url = 'https://www.youtube.com/channel/' + identifier
            pending_reason = ''
        if not name and not url:
            raise ValueError('A channel lead needs a name or a YouTube address.')
        key = identifier or url or 'lead:' + name.casefold()
        genres = row.get("genres") or row.get('Genre tags') or []
        if research_row and isinstance(genres, str):
            genres = [genre.strip() for genre in genres.split(';') if genre.strip()]
        if not isinstance(genres, list):
            raise ValueError("Channel genres must be a list.")
        if key in seen:
            existing = result[seen[key]]
            existing['genres'] = list(dict.fromkeys(existing['genres'] + [g[:60] for g in genres if isinstance(g,str)]))[:12]
            if name and name != existing['name'] and name not in existing['aliases']:
                existing['aliases'].append(name)
            continue
        seen[key] = len(result)
        provenance = row.get('research') if isinstance(row.get('research'), dict) else {}
        if research_row:
            provenance = {key:row.get(key) for key in ('Import gate','Priority','Kind','Sources','Source URL','Original URL','Alternate URLs','Validation state','Notes','New in deep dive')}
        result.append({"key": key, "url": url, "channel_id": identifier,
                       "name": name or key, "candidate_url": candidate_url,
                       "pending_reason": pending_reason,
                       "aliases": [str(alias)[:160] for alias in row.get('aliases',[]) if isinstance(alias,str)][:30],
                       "genres": list(dict.fromkeys(g[:60] for g in genres if isinstance(g, str)))[:12],
                       "category": str(row.get("category") or row.get('Category') or "")[:100],
                       "research": provenance})
    return result


class YouTubeRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urlsplit(newurl)
        if target.scheme != "https" or target.hostname not in ("youtube.com", "www.youtube.com") or target.port:
            raise ValueError("YouTube redirected outside the supported source.")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_public(url):
    request = Request(url, headers={"User-Agent": "RecordRoom/0.2 (channel-feed reader)", "Accept-Language": "en"})
    with build_opener(YouTubeRedirects).open(request, timeout=12) as response:
        body = response.read(3 * 1024 * 1024 + 1)
        if len(body) > 3 * 1024 * 1024:
            raise ValueError("Channel response was too large.")
        return body.decode("utf-8", errors="replace")


def record_year(title):
    # Upload dates are not release years. Only an unambiguous year in the title counts.
    years = set(re.findall(r"(?<!\d)((?:19|20)\d{2})(?!\d)", title))
    valid = [int(year) for year in years if 1900 <= int(year) <= time.gmtime().tm_year]
    return valid[0] if len(valid) == 1 else None


def read_channel(channel, fetch=fetch_public):
    if not channel.get('url'):
        raise ValueError('This lead needs a confirmed channel address before checking.')
    identifier = channel.get("channel_id")
    if not identifier:
        page = fetch(channel["url"])
        for pattern in (r'"externalId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"',
                        r'"channelId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"',
                        r'<link[^>]+rel="canonical"[^>]+href="https://www.youtube.com/channel/(UC[A-Za-z0-9_-]{22})"'):
            match = re.search(pattern, page)
            if match:
                identifier = match[1]
                break
        if not identifier:
            raise ValueError("Could not resolve this channel. Its address may have changed.")
    feed = fetch("https://www.youtube.com/feeds/videos.xml?channel_id=" + identifier)
    if "<!DOCTYPE" in feed.upper():
        raise ValueError("Unsupported channel feed.")
    root = ET.fromstring(feed)
    actual = root.findtext("yt:channelId", namespaces=NS)
    if actual not in (identifier, identifier[2:]):
        raise ValueError("The returned feed does not match this channel.")
    name = root.findtext("a:title", namespaces=NS) or channel["name"]
    records = []
    for entry in root.findall("a:entry", NS):
        identifier_video = entry.findtext("yt:videoId", namespaces=NS) or ""
        title = (entry.findtext("a:title", namespaces=NS) or "").strip()[:500]
        if not VIDEO.fullmatch(identifier_video) or not title:
            continue
        if re.search(r"\b(live\s*stream|livestream|upcoming|24/7|dj\s+(?:mix|set))\b", title, re.I):
            continue
        records.append({"id": identifier_video, "youtubeId": identifier_video, "title": title,
                        "artist": "", "trackTitle": "", "channel": name, "channelId": identifier,
                        "genre": "", "genres": channel["genres"], "genreHint": next(iter(channel["genres"]), ""),
                        "genreSource": "channel", "year": record_year(title),
                        "yearSource": "title", "source": "youtube-channel-feed",
                        "published": entry.findtext("a:published", namespaces=NS) or ""})
    return {"channel_id": identifier, "name": name, "records": records}


class ChannelLibrary:
    def __init__(self, root: Path, reader=read_channel, *, data_directory=None):
        self.root = Path(root)
        data=Path(data_directory) if data_directory else self.root/'data'
        self.seeds = data / "channels.json"
        self.cache = data / "discovery.json"
        self.reader = reader
        self.lock = threading.RLock()
        self.closed = threading.Event()
        self.channels, self.states, self.records = [], {}, {}
        self.running = False
        self.version = 0
        self.error = ""
        self.last_removed = None
        try:
            self.channels = normalize_channels(json.loads(self.seeds.read_text(encoding="utf-8-sig")))
        except FileNotFoundError:
            pass
        except (ValueError, OSError) as error:
            self.error = str(error)
        try:
            saved = json.loads(self.cache.read_text(encoding="utf-8"))
            self.states = saved.get("states", {})
            for record in saved.get("records", [])[-10000:]:
                if isinstance(record, dict) and isinstance(record.get("youtubeId"), str) and VIDEO.fullmatch(record["youtubeId"]):
                    self.records[record["youtubeId"]] = record
            self.version = int(saved.get("version", 0))
        except (OSError, ValueError, TypeError):
            pass

    def snapshot(self, version=None):
        with self.lock:
            states = [dict(self.states.get(channel["key"], {}), seedName=channel["name"],
                           key=channel['key'], url=channel['url'], genres=channel['genres'], pendingReason=channel.get('pending_reason','')) for channel in self.channels]
            result = {"version": self.version, "running": self.running, "total": len(self.channels),
                      "checked": sum(bool(state.get("checkedAt")) for state in states),
                      "working": sum(state.get("status") == "ready" for state in states),
                      "failed": sum(state.get("status") == "failed" for state in states),
                      "pending": sum(not channel['url'] for channel in self.channels),
                      "checkable": sum(bool(channel['url']) for channel in self.channels),
                      "recordCount": len(self.records), "error": self.error,
                      "provenance": "User-supplied independent seed list; not a verified Sample Digging export.",
                      "canUndo":self.last_removed is not None, "channels": states}
            if str(version) != str(self.version):
                result["records"] = list(self.records.values())
            return result

    def import_channels(self, data, *, refresh=True):
        channels = normalize_channels(data)
        with self.lock:
            if self.running:
                raise RuntimeError("Wait for channel checks to finish before replacing the list.")
            if channels == self.channels:
                return self.refresh() if refresh else self.snapshot()
            self.seeds.parent.mkdir(parents=True, exist_ok=True)
            staged = self.seeds.with_suffix('.tmp')
            staged.write_text(json.dumps({'schemaVersion':2,'channels':channels},ensure_ascii=False,indent=2),encoding='utf-8')
            staged.replace(self.seeds)
            # Keep validated states and records for retained addresses. New/changed
            # addresses must be checked rather than inheriting a name's validation.
            retained = {channel['key'] for channel in channels}
            states = {key:state for key,state in self.states.items() if key in retained}
            retained_ids = {c['channel_id'] for c in channels if c['channel_id']}
            retained_ids.update(state.get('channel_id') for state in states.values())
            cached = {key:record for key,record in self.records.items() if record.get('channelId') in retained_ids}
            self.channels = channels
            self.states = states
            self.records = cached
            self.version += 1
            self._save()
        return self.refresh() if refresh else self.snapshot()

    def refresh(self, force=False):
        with self.lock:
            if self.closed.is_set():
                raise RuntimeError("Channel discovery is closing.")
            if self.running:
                return self.snapshot()
            pending = [channel for channel in self.channels if channel['url'] and time.time() - self.states.get(channel["key"], {}).get("checkedAt", 0) > (60 if force else 86400)]
            if not pending:
                return self.snapshot()
            self.running, self.error = True, ""
            threading.Thread(target=self._scan, args=(pending,), daemon=True, name="channel-discovery").start()
            return self.snapshot()

    def _write_sources(self):
        self.seeds.parent.mkdir(parents=True,exist_ok=True)
        staged=self.seeds.with_suffix('.tmp')
        staged.write_text(json.dumps({'schemaVersion':2,'channels':self.channels},ensure_ascii=False,indent=2),encoding='utf-8')
        staged.replace(self.seeds)

    def add_channel(self, data):
        if not isinstance(data,dict) or set(data)-{'url','name','genres','replaceKey'}:
            raise ValueError('Enter a channel address, optional name and genres.')
        channel=normalize_channels([{'url':data.get('url'),'name':data.get('name'),'genres':data.get('genres',[])}])[0]
        if not channel['url']:raise ValueError('Enter a YouTube channel address.')
        replace=data.get('replaceKey')
        with self.lock:
            if len(self.channels)>=2000 and not replace:raise ValueError('This collection already has 2,000 sources.')
            if any(c['key']==channel['key'] and c['key']!=replace for c in self.channels):
                raise ValueError('This channel is already in your sources.')
            if replace:
                old=next((c for c in self.channels if c['key']==replace),None)
                if not old:raise ValueError('This channel is no longer in your sources.')
                channel['research']=old.get('research',{})
                if not data.get('name'):channel['name']=old['name']
                if not data.get('genres'):channel['genres']=old['genres']
                updated=[channel if c['key']==replace else c for c in self.channels]
            else:updated=self.channels+[channel]
            previous=self.channels;self.channels=updated
            try:self._write_sources()
            except OSError:self.channels=previous;raise
            if replace and replace!=channel['key']:
                old_state=self.states.pop(replace,{})
                old_id=old_state.get('channel_id') or old.get('channel_id')
                retained={c.get('channel_id') or self.states.get(c['key'],{}).get('channel_id') for c in self.channels}
                if old_id and old_id not in retained:self.records={k:r for k,r in self.records.items() if r.get('channelId')!=old_id}
            identifier=channel.get('channel_id') or self.states.get(channel['key'],{}).get('channel_id')
            for record in self.records.values():
                if identifier and record.get('channelId')==identifier:
                    record['genres']=channel['genres'];record['genreHint']=next(iter(channel['genres']),'')
            self.version+=1;self._save()
        return self.refresh()

    def remove_channel(self,key):
        with self.lock:
            channel=next((c for c in self.channels if c['key']==key),None)
            if not channel:raise ValueError('This channel is no longer in your sources.')
            state=self.states.get(key,{})
            channel_id=state.get('channel_id') or channel.get('channel_id')
            removed={k:r for k,r in self.records.items() if channel_id and r.get('channelId')==channel_id}
            previous=self.channels;self.channels=[c for c in self.channels if c['key']!=key]
            try:self._write_sources()
            except OSError:self.channels=previous;raise
            self.last_removed=(channel,state,removed,previous.index(channel))
            self.states.pop(key,None)
            # An alias may still source the same channel.
            retained={c.get('channel_id') or self.states.get(c['key'],{}).get('channel_id') for c in self.channels}
            if channel_id not in retained:
                for video in removed:self.records.pop(video,None)
            self.version+=1;self._save()
        return self.snapshot()

    def undo_remove(self):
        with self.lock:
            if not self.last_removed:raise ValueError('There is no channel removal to undo.')
            channel,state,records,index=self.last_removed
            if any(c['key']==channel['key'] for c in self.channels):raise ValueError('This source has already been restored.')
            self.channels.insert(index,channel)
            try:self._write_sources()
            except OSError:self.channels.remove(channel);raise
            self.states[channel['key']]=state;self.records.update(records)
            self.last_removed=None;self.version+=1;self._save()
        return self.snapshot()

    def preview(self,key):
        with self.lock:
            channel=next((c for c in self.channels if c['key']==key),None)
            if not channel:raise ValueError('This channel is no longer in your sources.')
            state=self.states.get(key,{})
            identifier=state.get('channel_id') or channel.get('channel_id')
            records=sorted((r for r in self.records.values() if identifier and r.get('channelId')==identifier),key=lambda r:r.get('published',''),reverse=True)[:10]
            return {'key':key,'name':state.get('name') or channel['name'],'url':channel['url'],'records':records,'status':state.get('status','pending')}

    def _scan(self, pending):
        work = queue.Queue()
        for channel in pending:
            work.put(channel)
        def worker():
            while not self.closed.is_set():
                try:
                    channel = work.get_nowait()
                except queue.Empty:
                    return
                state = {"checkedAt": time.time(), "status": "failed", "name": channel["name"]}
                with self.lock:
                    if not any(c['key']==channel['key'] for c in self.channels):continue
                try:
                    resolved = self.reader(channel)
                    state.update(status="ready", name=resolved["name"], channel_id=resolved["channel_id"], count=len(resolved["records"]))
                    with self.lock:
                        if not any(c['key']==channel['key'] for c in self.channels):continue
                        current=next(c for c in self.channels if c['key']==channel['key'])
                        for record in resolved["records"]:
                            record['genres']=current['genres'];record['genreHint']=next(iter(current['genres']),'')
                            if record["youtubeId"] not in self.records:
                                self.records[record["youtubeId"]] = record
                                self.version += 1
                        self.records = dict(list(self.records.items())[-10000:])
                except Exception as error:
                    state["error"] = "Channel not available at this address." if isinstance(error, HTTPError) and error.code in (404, 410) else "Could not check this channel. Try again later."
                with self.lock:
                    if not any(c['key']==channel['key'] for c in self.channels):continue
                    self.states[channel["key"]] = state
                    self._save()
                self.closed.wait(.2)
        workers = [threading.Thread(target=worker, daemon=True) for _ in range(min(3, len(pending)))]
        try:
            for thread in workers:
                thread.start()
            for thread in workers:
                thread.join()
        finally:
            with self.lock:
                self.running = False
                self._save()
            # Sources added during a scan are checked next, without restarting old work.
            if not self.closed.is_set():self.refresh()

    def _save(self):
        for attempt in range(5):
            try:
                self.cache.parent.mkdir(parents=True, exist_ok=True)
                staged = self.cache.with_suffix(".tmp")
                staged.write_text(json.dumps({"version": self.version, "states": self.states, "records": list(self.records.values())}, ensure_ascii=False), encoding="utf-8")
                staged.replace(self.cache)
                if self.error.startswith("Channel cache"):
                    self.error = ""
                return
            except OSError:
                self.closed.wait(.05 * (attempt + 1))
        self.error = "Channel cache could not be saved. Check that the data folder is writable."

    def close(self):
        self.closed.set()
