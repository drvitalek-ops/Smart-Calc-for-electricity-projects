from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Event,Lock
import pytest
from app.quotation_cache import RenderCache,quotation_key
from app.quotations import QuoteInput,QuoteLine


def test_byte_budget_lru_and_expiry():
    now=[0]
    cache=RenderCache(max_bytes=20,max_items=2,ttl=5,clock=lambda:now[0])
    assert cache.get_or_create('a',lambda:b'12345678')==b'12345678'
    cache.get_or_create('b',lambda:b'abcdefgh')
    assert cache.retained_bytes==16
    cache.get_or_create('a',lambda:pytest.fail('hot entry was evicted'))
    cache.get_or_create('c',lambda:b'CCCCCCCC')
    assert cache.retained_bytes<=20
    assert cache.get_or_create('b',lambda:b'new')==b'new'
    now[0]=6
    assert cache.get_or_create('a',lambda:b'expired')==b'expired'
    assert cache.retained_bytes==7
    cache.clear();assert cache.retained_bytes==0


def test_oversized_results_are_shared_but_not_retained():
    cache=RenderCache(max_bytes=10)
    assert cache.get_or_create('large',lambda:b'x'*9)==b'x'*9
    assert cache.retained_bytes==0


def test_concurrent_misses_generate_once_and_errors_can_retry():
    cache=RenderCache();started=Event();release=Event();lock=Lock();calls=[]
    def render():
        with lock:calls.append(1)
        started.set();assert release.wait(3);return b'valid'
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures=[pool.submit(cache.get_or_create,'one',render) for _ in range(8)]
        assert started.wait(3);release.set()
        assert [item.result(timeout=3) for item in futures]==[b'valid']*8
    assert len(calls)==1
    def broken():raise ValueError('render failed')
    with pytest.raises(ValueError):cache.get_or_create('broken',broken)
    assert cache.get_or_create('broken',lambda:b'retry')==b'retry'


def test_quote_cache_keys_include_every_visible_edit_and_mode_but_not_revision():
    quote=QuoteInput(number='test',lines=[QuoteLine(id='a',name='Лампа',quantity=1,unit_price=100)])
    initial=quotation_key(quote,'partner',(1,False))
    quote.revision+=1
    assert quotation_key(quote,'partner',(1,False))==initial
    assert quotation_key(quote,'client',(1,False))!=initial
    assert quotation_key(quote,'partner',(2,False))!=initial
    quote.lines[0].unit_price=Decimal('200')
    assert quotation_key(quote,'partner',(1,False))!=initial
