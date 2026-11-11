"""Bounded, transient rendering cache. Saved project data never lives here."""
import hashlib
import json
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass,field


@dataclass
class _Pending:
    ready:threading.Event=field(default_factory=threading.Event)
    value:bytes|None=None
    error:BaseException|None=None


class RenderCache:
    def __init__(self,max_bytes=48*1024*1024,max_items=32,ttl=180,clock=time.monotonic):
        self.max_bytes=max_bytes
        self.max_items=max_items
        self.ttl=ttl
        self.clock=clock
        self._lock=threading.Lock()
        self._items=OrderedDict()
        self._pending={}
        self._bytes=0

    def _expire(self,now):
        for key,(expires,value) in list(self._items.items()):
            if expires<=now:
                self._bytes-=len(value)
                del self._items[key]

    def get_or_create(self,key,create):
        with self._lock:
            self._expire(self.clock())
            hit=self._items.get(key)
            if hit is not None:
                self._items.move_to_end(key)
                return hit[1]
            pending=self._pending.get(key)
            owner=pending is None
            if owner:
                pending=_Pending()
                self._pending[key]=pending
        if not owner:
            pending.ready.wait()
            if pending.error is not None:raise pending.error
            return pending.value
        try:
            value=create()
            if not isinstance(value,bytes):raise TypeError('Render cache accepts bytes only')
            with self._lock:
                self._expire(self.clock())
                if len(value)<=self.max_bytes//2:
                    while self._items and (self._bytes+len(value)>self.max_bytes or len(self._items)>=self.max_items):
                        _,(_,old)=self._items.popitem(last=False)
                        self._bytes-=len(old)
                    self._items[key]=(self.clock()+self.ttl,value)
                    self._bytes+=len(value)
                pending.value=value
            return value
        except BaseException as exc:
            pending.error=exc
            raise
        finally:
            with self._lock:
                self._pending.pop(key,None)
                pending.ready.set()

    def clear(self):
        with self._lock:
            self._items.clear()
            self._bytes=0

    @property
    def retained_bytes(self):
        with self._lock:return self._bytes


RENDER_CACHE=RenderCache()
RENDER_LOCK=threading.RLock()


def quotation_key(quote,mode,scope):
    payload=quote.model_dump(mode='json',exclude={'revision'})
    digest=hashlib.sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).digest()
    return (*scope,mode,digest)


def quotation_pdf(quote,mode,scope):
    key=('pdf',*quotation_key(quote,mode,scope))
    def create():
        from .quotation_pdf import export_quotation
        with RENDER_LOCK:return export_quotation(quote,mode)
    return RENDER_CACHE.get_or_create(key,create)


def quotation_page(quote,mode,page,scope):
    key=('png',*quotation_key(quote,mode,scope),page)
    def create():
        import pymupdf
        from fastapi import HTTPException
        document=quotation_pdf(quote,mode,scope)
        with RENDER_LOCK,pymupdf.open(stream=document,filetype='pdf') as pdf:
            if page<1 or page>len(pdf):raise HTTPException(422,'Страница вне диапазона')
            # Prefix the page count so PNG bytes and pagination are cached together.
            return len(pdf).to_bytes(4,'big')+pdf[page-1].get_pixmap(matrix=pymupdf.Matrix(2,2),alpha=False).tobytes('png')
    cached=RENDER_CACHE.get_or_create(key,create)
    return int.from_bytes(cached[:4],'big'),cached[4:]
