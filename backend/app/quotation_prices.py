"""Reuse a known CP price only for an unambiguously identical item."""
import re
from collections import defaultdict


def folded(value):
    return re.sub(r'\s+',' ',value.strip()).lower().replace('ё','е')


def price_identity(line):
    common=(line.unit,line.currency)
    if folded(line.sku):return ('sku',folded(line.sku),folded(line.manufacturer),*common)
    if line.product_id:return ('product',line.product_id,*common)
    return ('position',line.type_id,folded(line.name),folded(line.manufacturer),folded(line.description),re.sub(r'^ip\s*','',folded(line.ip)),*common)


def general_quote(quote):
    return quote.room_layout=='combined' or quote.room_layout=='legacy' and not any(line.room.strip() not in ('','Без помещения') for line in quote.lines)


def inherit_prices(quote):
    if not general_quote(quote):return quote
    known=defaultdict(set)
    for line in quote.lines:
        if line.unit_price>0:known[price_identity(line)].add(line.unit_price)
    for line in quote.lines:
        prices=known[price_identity(line)]
        if line.unit_price==0 and len(prices)==1:
            line.unit_price=next(iter(prices))
            if line.source_key:line.overrides=sorted(set(line.overrides)|{'unit_price'})
    return quote
