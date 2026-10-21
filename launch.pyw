"""Open the local listening room without a terminal window on Windows."""
from pathlib import Path
import ctypes
import threading
import urllib.request
import webbrowser

from server import RecordRoomServer

ADDRESS = ('127.0.0.1', 8771)
URL = 'http://127.0.0.1:8771/'


def main():
    try:
        with urllib.request.urlopen(URL, timeout=1) as response:
            if b'Record Room' in response.read(8192):
                webbrowser.open(URL)
                return
    except (OSError, ValueError):
        pass
    try:
        server = RecordRoomServer(ADDRESS)
    except OSError as error:
        message = 'Record Room could not start. Port 8771 may be in use.\n\n' + str(error)
        try:
            ctypes.windll.user32.MessageBoxW(None, message, 'Record Room', 0x10)
        except AttributeError:
            print(message)
        return
    threading.Timer(.25, lambda: webbrowser.open(URL)).start()
    try:
        server.serve_forever(poll_interval=.25)
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
