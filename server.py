"""Local Record Room server and an optional, input-only Windows MIDI bridge.

Run with ``python server.py --port 8770``. No third-party packages are required.
The MIDI device remains closed until the page explicitly connects it.
"""

from __future__ import annotations

import argparse
import ctypes
import ipaddress
import json
import mimetypes
import os
from pathlib import Path
import queue
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit, parse_qs
from downloads import DownloadQueue, VIDEO_ID
from discovery import ChannelLibrary
from exclusions import ExcludedRecords


def decode_short_message(packed: int) -> list[int] | None:
    """Decode a complete WinMM short message; never accept a SysEx message."""
    status = packed & 0xFF
    first = (packed >> 8) & 0xFF
    second = (packed >> 16) & 0xFF
    if 0x80 <= status <= 0xEF:
        if first > 127:
            return None
        if status & 0xF0 in (0xC0, 0xD0):
            return [status, first, 0]
        return [status, first, second] if second <= 127 else None
    if status in (0xF1, 0xF3):
        return [status, first, 0] if first <= 127 else None
    if status == 0xF2:
        return [status, first, second] if first <= 127 and second <= 127 else None
    if status in (0xF6, 0xF8, 0xFA, 0xFB, 0xFC, 0xFE, 0xFF):
        return [status, 0, 0]
    return None


class EventHub:
    """Each listener has a bounded queue; a slow tab cannot block MIDI input."""

    def __init__(self, capacity: int = 256):
        self.capacity = capacity
        self._lock = threading.Lock()
        self._listeners: set[queue.Queue] = set()
        self.closed = threading.Event()

    def subscribe(self) -> queue.Queue:
        listener = queue.Queue(maxsize=self.capacity)
        with self._lock:
            if self.closed.is_set():
                listener.put_nowait(None)
            else:
                self._listeners.add(listener)
        return listener

    def unsubscribe(self, listener: queue.Queue) -> None:
        with self._lock:
            self._listeners.discard(listener)

    def publish(self, event: dict) -> None:
        with self._lock:
            if self.closed.is_set():
                return
            for listener in self._listeners:
                if listener.full():
                    try:
                        listener.get_nowait()
                    except queue.Empty:
                        pass
                try:
                    listener.put_nowait(event)
                except queue.Full:
                    pass

    def close(self) -> None:
        with self._lock:
            self.closed.set()
            for listener in self._listeners:
                while not listener.empty():
                    try:
                        listener.get_nowait()
                    except queue.Empty:
                        break
                listener.put_nowait(None)
            self._listeners.clear()


class WindowsMidiInput:
    """Small WinMM MIDI input wrapper. It never opens or sends to MIDI outputs."""

    MIM_DATA = 0x3C3
    MIM_MOREDATA = 0x3CC
    CALLBACK_FUNCTION = 0x30000

    def __init__(self, hub: EventHub):
        self.hub = hub
        self._lock = threading.RLock()
        self._winmm = None
        self._capabilities = None
        self._callback_type = None
        self._callback = None
        self._handle = None
        self._port = None
        self._name = None
        self._error = None
        self._initialization_attempted = False

    def _initialize(self) -> bool:
        if self._initialization_attempted:
            return self._winmm is not None
        self._initialization_attempted = True
        if os.name != "nt":
            self._error = "The local MIDI bridge is available on Windows. Use browser MIDI if supported."
            return False
        try:
            from ctypes import wintypes

            class MIDIINCAPSW(ctypes.Structure):
                _fields_ = [
                    ("wMid", wintypes.WORD),
                    ("wPid", wintypes.WORD),
                    ("vDriverVersion", wintypes.DWORD),
                    ("szPname", wintypes.WCHAR * 32),
                    ("dwSupport", wintypes.DWORD),
                ]

            library = ctypes.WinDLL("winmm")
            callback_type = ctypes.WINFUNCTYPE(
                None, ctypes.c_void_p, wintypes.UINT,
                ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t,
            )
            signatures = {
                "midiInGetNumDevs": ([], wintypes.UINT),
                "midiInGetDevCapsW": ([ctypes.c_size_t, ctypes.POINTER(MIDIINCAPSW), wintypes.UINT], wintypes.UINT),
                "midiInOpen": ([ctypes.POINTER(ctypes.c_void_p), wintypes.UINT, ctypes.c_size_t, ctypes.c_size_t, wintypes.DWORD], wintypes.UINT),
                "midiInStart": ([ctypes.c_void_p], wintypes.UINT),
                "midiInStop": ([ctypes.c_void_p], wintypes.UINT),
                "midiInReset": ([ctypes.c_void_p], wintypes.UINT),
                "midiInClose": ([ctypes.c_void_p], wintypes.UINT),
                "midiInGetErrorTextW": ([wintypes.UINT, wintypes.LPWSTR, wintypes.UINT], wintypes.UINT),
            }
            for name, (arguments, result) in signatures.items():
                function = getattr(library, name)
                function.argtypes = arguments
                function.restype = result
            self._capabilities = MIDIINCAPSW
            self._callback_type = callback_type
            self._winmm = library
            return True
        except (AttributeError, OSError) as error:
            self._error = f"Windows MIDI could not start: {error}"
            return False

    def _message(self, code: int) -> str:
        buffer = ctypes.create_unicode_buffer(256)
        if self._winmm.midiInGetErrorTextW(code, buffer, len(buffer)) == 0:
            return buffer.value
        return f"Windows MIDI error {code}"

    def ports(self) -> dict:
        with self._lock:
            if not self._initialize():
                return {"available": False, "ports": [], "error": self._error}
            ports = []
            for port in range(self._winmm.midiInGetNumDevs()):
                capabilities = self._capabilities()
                result = self._winmm.midiInGetDevCapsW(port, ctypes.byref(capabilities), ctypes.sizeof(capabilities))
                if result == 0:
                    ports.append({"id": port, "name": capabilities.szPname})
            return {"available": True, "ports": ports}

    def status(self) -> dict:
        with self._lock:
            return {
                "connected": self._handle is not None,
                "port": self._port,
                "name": self._name,
                "error": self._error,
            }

    def connect(self, port: int | None) -> dict:
        with self._lock:
            if port is None:
                self._close_locked()
                self._error = None
                return self.status()
            if self._handle is not None and self._port == port:
                return self.status()
            available = self.ports()
            if not available["available"]:
                raise RuntimeError(self._error)
            device = next((item for item in available["ports"] if item["id"] == port), None)
            if device is None:
                raise ValueError("That MIDI input is no longer available. Refresh the input list.")
            self._close_locked()

            def receive(_handle, message, _instance, packed, _timestamp):
                # Never allow an exception to escape a native callback.
                try:
                    if message in (self.MIM_DATA, self.MIM_MOREDATA):
                        data = decode_short_message(packed)
                        if data is not None:
                            self.hub.publish({"data": data, "port": port, "time": time.time()})
                except Exception:
                    pass

            callback = self._callback_type(receive)
            handle = ctypes.c_void_p()
            result = self._winmm.midiInOpen(
                ctypes.byref(handle), port, ctypes.cast(callback, ctypes.c_void_p).value,
                0, self.CALLBACK_FUNCTION,
            )
            if result:
                self._error = "Could not open this MIDI input. Close other apps using it and try again. " + self._message(result)
                raise RuntimeError(self._error)
            # Retain the ctypes callback for the complete lifetime of the handle.
            self._handle = handle
            self._callback = callback
            self._port = port
            self._name = device["name"]
            result = self._winmm.midiInStart(handle)
            if result:
                message = self._message(result)
                self._close_locked()
                self._error = "The MIDI input opened but could not start. " + message
                raise RuntimeError(self._error)
            self._error = None
            return self.status()

    def _close_locked(self) -> None:
        if self._handle is not None:
            handle = self._handle
            self._winmm.midiInStop(handle)
            self._winmm.midiInReset(handle)
            self._winmm.midiInClose(handle)
        self._handle = None
        self._callback = None
        self._port = None
        self._name = None

    def close(self) -> None:
        with self._lock:
            self._close_locked()


class RecordRoomServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address=("127.0.0.1", 8770), root: Path | None = None, midi=None, *, data_directory=None):
        if not ipaddress.ip_address(address[0]).is_loopback:
            raise ValueError("Record Room only accepts a loopback listening address.")
        self.root = (root or Path(__file__).parent).resolve()
        self.data = Path(data_directory).resolve() if data_directory else self.root/'data'
        self.hub = EventHub()
        self.midi = midi or WindowsMidiInput(self.hub)
        self.exclusions = ExcludedRecords(self.data)
        self.downloads = DownloadQueue(self.root,data_directory=self.data,exclusions=self.exclusions)
        self.downloads.snapshot()  # Migrate known unavailable downloads before any lists are served.
        self.discovery = ChannelLibrary(self.root,data_directory=self.data)
        self._resources_closed = False
        super().__init__(address, RecordRoomHandler)

    def verify_request(self, request, client_address):
        return ipaddress.ip_address(client_address[0]).is_loopback

    def server_close(self):
        if not self._resources_closed:
            self._resources_closed = True
            self.midi.close()
            self.downloads.close()
            self.discovery.close()
            self.hub.close()
        super().server_close()


class RecordRoomHandler(BaseHTTPRequestHandler):
    server_version = "RecordRoom/0.1"

    def log_message(self, format, *arguments):
        # Keep terminal output useful: MIDI events and status polling are quiet.
        pass

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        super().end_headers()

    def _json(self, status: int, body: dict):
        if isinstance(body, dict) and ('records' in body or 'channels' in body):
            body = dict(body, excludedIds=self.server.exclusions.snapshot())
            if isinstance(body.get('records'), list):
                body['records'] = self.server.exclusions.filter(body['records'])
                if 'recordCount' in body: body['recordCount'] = len(body['records'])
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def _context_is_safe(self, require_origin=False) -> bool:
        hosts = self.headers.get_all("Host", [])
        try:
            if len(hosts) != 1:
                raise ValueError
            host = urlsplit("http://" + hosts[0])
            if (host.hostname not in ("127.0.0.1", "localhost", "::1")
                    or host.username is not None or host.password is not None
                    or host.path or host.query or host.fragment
                    or (host.port or 80) != self.server.server_port):
                raise ValueError
        except ValueError:
            self._json(HTTPStatus.FORBIDDEN, {"error": "Open Record Room using its local address."})
            return False
        origins = self.headers.get_all("Origin", [])
        if require_origin and not origins:
            self._json(HTTPStatus.FORBIDDEN, {"error": "Connect MIDI from the Record Room page."})
            return False
        if origins and (len(origins) != 1 or origins[0] != "http://" + hosts[0]):
            self._json(HTTPStatus.FORBIDDEN, {"error": "This request must come from the same Record Room page."})
            return False
        return True

    def do_GET(self):
        if not self._context_is_safe():
            return
        path = urlsplit(self.path).path
        if path == '/api/collection/exclusions':
            self._json(HTTPStatus.OK, {'excludedIds': self.server.exclusions.snapshot()})
        elif path == "/api/midi/ports":
            self._json(HTTPStatus.OK, self.server.midi.ports())
        elif path == "/api/midi/status":
            self._json(HTTPStatus.OK, self.server.midi.status())
        elif path == "/api/midi/events":
            self._events()
        elif path == '/api/health':
            self._json(HTTPStatus.OK,{'app':'Record Room','version':'0.2.0'})
        elif path == '/api/discovery/preview':
            try:self._json(HTTPStatus.OK,self.server.discovery.preview(parse_qs(urlsplit(self.path).query).get('key',[''])[0]))
            except ValueError as error:self._json(HTTPStatus.NOT_FOUND,{'error':str(error)})
        elif path == "/api/downloads":
            self._json(HTTPStatus.OK, self.server.downloads.snapshot())
        elif path == "/api/discovery":
            version = parse_qs(urlsplit(self.path).query).get("version", [None])[0]
            self._json(HTTPStatus.OK, self.server.discovery.snapshot(version))
        elif path.startswith("/api/audio/"):
            self._audio(path.removeprefix("/api/audio/"))
        elif path.startswith("/api/"):
            self._json(HTTPStatus.NOT_FOUND, {"error": "Unknown Record Room request."})
        else:
            self._static(path)

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        if not self._context_is_safe(require_origin=True):
            return
        request_path = urlsplit(self.path).path
        if request_path not in ('/api/collection/exclusions', "/api/midi/connect", "/api/downloads", "/api/downloads/cancel", '/api/downloads/directory', "/api/discovery/refresh", "/api/discovery/channels", '/api/discovery/add', '/api/discovery/remove', '/api/discovery/undo'):
            self._json(HTTPStatus.NOT_FOUND, {"error": "Unknown Record Room request."})
            return
        if self.headers.get("Transfer-Encoding"):
            self._json(HTTPStatus.BAD_REQUEST, {"error": "A JSON request with a content length is required."})
            return
        if self.headers.get_content_type() != "application/json":
            self._json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "Send the MIDI selection as JSON."})
            return
        try:
            lengths = self.headers.get_all("Content-Length", [])
            if len(lengths) != 1:
                raise ValueError
            length = int(lengths[0])
            if not 0 < length <= (2000000 if request_path.startswith('/api/discovery') else 200000 if request_path.startswith('/api/downloads') else 4096):
                raise ValueError
        except ValueError:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "The MIDI selection request is missing or too large."})
            return
        self.connection.settimeout(5)
        try:
            payload = json.loads(self.rfile.read(length))
            if request_path == '/api/collection/exclusions':
                if not isinstance(payload,dict) or set(payload) != {'ids'}:
                    raise ValueError
                try:
                    self._json(HTTPStatus.OK, {'excludedIds':self.server.exclusions.add(payload['ids'])})
                except OSError:
                    self._json(HTTPStatus.CONFLICT, {'error':'Unavailable records could not be saved. Check collection folder access.'})
                return
            if request_path.startswith('/api/discovery/'):
                try:
                    if request_path.endswith('/refresh'):
                        if not isinstance(payload, dict) or set(payload) - {'force'} or ('force' in payload and type(payload['force']) is not bool):
                            raise ValueError('Choose a normal or explicit channel refresh.')
                        result = self.server.discovery.refresh(force=payload.get('force',False))
                    elif request_path.endswith('/add'):
                        result=self.server.discovery.add_channel(payload)
                    elif request_path.endswith('/remove'):
                        if not isinstance(payload,dict) or set(payload)!={'key'} or not isinstance(payload['key'],str):raise ValueError('Choose a channel to remove.')
                        result=self.server.discovery.remove_channel(payload['key'])
                    elif request_path.endswith('/undo'):
                        if payload!={}:raise ValueError('Send an empty undo request.')
                        result=self.server.discovery.undo_remove()
                    else:
                        result = self.server.discovery.import_channels(payload)
                    self._json(HTTPStatus.OK, result)
                except ValueError as error:
                    self._json(HTTPStatus.BAD_REQUEST, {'error': str(error)})
                except (RuntimeError, OSError) as error:
                    self._json(HTTPStatus.CONFLICT, {'error': str(error)})
                return
            if request_path.startswith('/api/downloads'):
                if request_path.endswith('/directory'):
                    try:
                        if not isinstance(payload,dict) or set(payload)!={'directory'}:raise ValueError('Choose a record collection folder.')
                        self._json(HTTPStatus.OK,self.server.downloads.set_directory(payload['directory']))
                    except ValueError as error:self._json(HTTPStatus.BAD_REQUEST,{'error':str(error)})
                    except (RuntimeError,OSError) as error:self._json(HTTPStatus.CONFLICT,{'error':str(error)})
                    return
                key = 'ids' if request_path.endswith('/cancel') else 'records'
                if not isinstance(payload, dict) or set(payload) != {key}:
                    raise ValueError
                try:
                    result = self.server.downloads.cancel(payload[key]) if key == 'ids' else self.server.downloads.enqueue(payload[key])
                    self._json(HTTPStatus.OK, result)
                except ValueError as error:
                    self._json(HTTPStatus.BAD_REQUEST, {'error': str(error)})
                except RuntimeError as error:
                    self._json(HTTPStatus.CONFLICT, {'error': str(error)})
                return
            if not isinstance(payload, dict) or set(payload) != {"id"}:
                raise ValueError
            port = payload["id"]
            if port is not None and (type(port) is not int or port < 0):
                raise ValueError
        except (ValueError, UnicodeDecodeError, TimeoutError):
            self._json(HTTPStatus.BAD_REQUEST, {"error": "Choose a MIDI input number, or null to disconnect."})
            return
        try:
            self._json(HTTPStatus.OK, self.server.midi.connect(port))
        except ValueError as error:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except RuntimeError as error:
            self._json(HTTPStatus.CONFLICT, {"error": str(error)})

    def _static(self, request_path: str):
        try:
            path = unquote(request_path, errors="strict")
            if "\x00" in path or "\\" in path or ".." in path.split("/"):
                raise ValueError
            if any(part.startswith('.') for part in path.split('/') if part) or path.startswith(('/tools/', '/data/audio/', '/data/downloads')):
                raise ValueError
            public = {'/', '/index.html', '/app.js', '/presentation.js', '/engine.js', '/mechanics.js', '/interactions.js', '/matrix.js', '/varispeed.js',
                      '/style.css', '/listening.css', '/minimal.css', '/supplied.css', '/library.css', '/library.js', '/data/crate.json',
                      '/tests/audio-check.html', '/tests/audio-check.js'}
            if path not in public and not path.startswith('/assets/'):
                raise ValueError
            candidate = (self.server.root / path.lstrip("/")).resolve()
            if candidate != self.server.root and self.server.root not in candidate.parents:
                raise ValueError
            if candidate == self.server.root:
                candidate = (candidate / "index.html").resolve()
                if self.server.root not in candidate.parents:
                    raise ValueError
            if not candidate.is_file():
                self._json(HTTPStatus.NOT_FOUND, {"error": "This file is not in Record Room."})
                return
            content = candidate.read_bytes()
        except (ValueError, OSError, UnicodeError):
            self._json(HTTPStatus.FORBIDDEN, {"error": "Only files inside Record Room can be opened."})
            return
        media_type = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
        if media_type.startswith("text/") or media_type in ("application/javascript", "application/json"):
            media_type += "; charset=utf-8"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", media_type)
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(content)

    def _audio(self, video_id):
        file = self.server.downloads.file(video_id)
        if not file:
            self._json(HTTPStatus.NOT_FOUND, {'error': 'This record has no downloaded audio yet.'})
            return
        size = file.stat().st_size
        self.send_response(HTTPStatus.OK)
        self.send_header('Content-Type', 'audio/flac')
        self.send_header('Cache-Control', 'private, max-age=3600')
        self.send_header('Content-Length', str(size))
        self.end_headers()
        if self.command != 'HEAD':
            try:
                with file.open('rb') as source:
                    while chunk := source.read(128 * 1024):
                        self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _events(self):
        if self.command == "HEAD":
            self.send_response(HTTPStatus.METHOD_NOT_ALLOWED)
            self.send_header("Allow", "GET")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        listener = self.server.hub.subscribe()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        self.connection.settimeout(10)
        try:
            self.wfile.write(b": Record Room MIDI input ready\n\n")
            self.wfile.flush()
            while not self.server.hub.closed.is_set():
                try:
                    event = listener.get(timeout=5)
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                else:
                    if event is None:
                        break
                    payload = json.dumps(event, separators=(",", ":")).encode("utf-8")
                    self.wfile.write(b"data: " + payload + b"\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, TimeoutError, OSError):
            pass
        finally:
            self.server.hub.unsubscribe(listener)


def main():
    if getattr(sys,'frozen',False):
        import certifi
        os.environ.setdefault('SSL_CERT_FILE',certifi.where())
    if len(sys.argv)>1 and sys.argv[1]=='--download-worker':
        import yt_dlp
        yt_dlp.main(sys.argv[2:])
        return
    parser = argparse.ArgumentParser(description="Open Record Room locally, with optional input-only Windows MIDI.")
    parser.add_argument("--port", type=int, default=8771)
    parser.add_argument('--root',type=Path,default=Path(__file__).parent)
    parser.add_argument('--data-directory',type=Path)
    parser.add_argument('--desktop',action='store_true')
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("port must be between 0 and 65535")
    server = RecordRoomServer(("127.0.0.1", args.port),args.root,data_directory=args.data_directory)
    if args.desktop:
        print('RECORD_ROOM_READY='+json.dumps({'port':server.server_port}),flush=True)
        def parent_closed():
            try:
                while sys.stdin.buffer.read(1):pass
            except (OSError,AttributeError):pass
            server.shutdown()
        threading.Thread(target=parent_closed,daemon=True).start()
    print(f"Record Room: http://127.0.0.1:{server.server_port}/", flush=True)
    print("MIDI is disconnected. Select an input in the app when ready. Ctrl+C closes the server.", flush=True)
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
