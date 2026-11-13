"""Accept Russian decimal notation without guessing malformed digit grouping."""
import re
from decimal import Decimal
from typing import Annotated
from pydantic import BeforeValidator


def normalize_decimal(value):
    if not isinstance(value,str):return value
    value=value.strip()
    if re.fullmatch(r'[+-]?\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?',value):
        value=re.sub(r'[ \u00a0\u202f]','',value)
    if ',' in value and '.' not in value and value.count(',')==1:
        value=value.replace(',','.')
    return value


RussianDecimal=Annotated[Decimal,BeforeValidator(normalize_decimal)]
