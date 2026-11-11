"""Short-lived download tickets keep large backup ZIPs out of browser memory."""
from pathlib import Path
import secrets
import threading
import time


class BackupDownloads:
    def __init__(self,ttl=600):
        self.ttl=ttl
        self._lock=threading.Lock()
        self._files={}
        self.build_lock=threading.Lock()

    def _expire(self):
        for key,(path,deadline,name) in list(self._files.items()):
            if deadline<=time.monotonic():
                path.unlink(missing_ok=True)
                self._files.pop(key,None)

    def add(self,path,name):
        with self._lock:
            self._expire()
            # One completed file per instance is enough: a new export replaces
            # an unused older ticket, without disturbing a running download.
            for old,_,_ in self._files.values():old.unlink(missing_ok=True)
            self._files.clear()
            key=secrets.token_urlsafe(32)
            self._files[key]=(Path(path),time.monotonic()+self.ttl,name)
            return key

    def take(self,key):
        with self._lock:
            self._expire()
            record=self._files.pop(key,None)
            return (record[0],record[2]) if record else None

    def clear(self):
        with self._lock:
            for path,_,_ in self._files.values():path.unlink(missing_ok=True)
            self._files.clear()


BACKUP_DOWNLOADS=BackupDownloads()
