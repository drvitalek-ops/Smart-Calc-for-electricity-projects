"""Keep generated CP totals at the position requested in the corrected sample."""
import pymupdf
import pytest
from app.quotation_pdf import export_quotation,number,currency
from app.quotations import QuoteInput,QuoteLine,totals


def spans(page):
    return [span for block in page.get_text('dict')['blocks'] for line in block.get('lines',[]) for span in line['spans']]


def total_bar(page):
    return next(drawing['rect'] for drawing in page.get_drawings()
        if drawing['fill'] and drawing['rect'].x0==32 and drawing['rect'].width>500
        and drawing['rect'].y0>=300 and max(drawing['fill'])<.2)


@pytest.mark.parametrize('mode',['client','partner'])
@pytest.mark.parametrize('tax_note',['Включая НДС',''])
def test_amount_matches_corrected_sample_position(mode,tax_note):
    quote=QuoteInput(number='С-1',customer='Покупатель',tax_note=tax_note,global_discount='10',
        lines=[QuoteLine(id='sample',name='Товар',quantity=1,unit_price='215627.94')])
    value=number(totals(quote,mode)['totals']['RUB']['total'])+' ₽'
    with pymupdf.open(stream=export_quotation(quote,mode),filetype='pdf') as document:
        page=document[0];bar=total_bar(page)
        amount=next(span for span in spans(page) if span['text']==value and span['size']>15)
        assert amount['origin'][1]==pytest.approx(bar.y0+37.164,abs=.3)
        assert amount['bbox'][2]==pytest.approx(bar.x1-22,abs=.05)
        assert bar.contains(pymupdf.Rect(amount['bbox']))
        assert amount['font']=='GolosText-Black'
        if tax_note:
            tax=next(span for span in spans(page) if span['text']==tax_note)
            assert amount['bbox'][3]+6<tax['bbox'][1]


@pytest.mark.parametrize('mode',['client','partner'])
def test_three_currency_totals_do_not_overlap_each_other_or_tax(mode):
    quote=QuoteInput(global_discount='12.5',lines=[
        QuoteLine(id=code,name='Товар '+code,unit_price='123456.78',currency=code)
        for code in ('RUB','EUR','USD')])
    expected={number(row['total'])+' '+currency(code) for code,row in totals(quote,mode)['totals'].items()}
    with pymupdf.open(stream=export_quotation(quote,mode),filetype='pdf') as document:
        page=document[0];bar=total_bar(page)
        amounts=sorted((span for span in spans(page) if span['text'] in expected and span['size']>15),key=lambda span:span['bbox'][1])
        assert len(amounts)==3
        for amount in amounts:
            assert bar.contains(pymupdf.Rect(amount['bbox']))
            assert amount['bbox'][2]==pytest.approx(bar.x1-22,abs=.05)
        for above,below in zip(amounts,amounts[1:]):assert above['bbox'][3]+2<below['bbox'][1]
        tax=next(span for span in spans(page) if span['text']==quote.tax_note)
        assert amounts[-1]['bbox'][3]+6<tax['bbox'][1]


def test_large_amount_keeps_its_measured_font_and_right_alignment():
    quote=QuoteInput(lines=[QuoteLine(id='large',name='Товар',quantity=1000000,unit_price=1000000000,currency='CHF')])
    expected='1 000 000 000 000 000,00 CHF'
    with pymupdf.open(stream=export_quotation(quote,'client'),filetype='pdf') as document:
        page=document[0];bar=total_bar(page)
        amount=next(span for span in spans(page) if span['text']==expected)
        assert amount['size']<16,'Exercise the formerly mismatched fitted font'
        assert amount['font']=='GolosText-Black'
        assert amount['bbox'][2]==pytest.approx(bar.x1-22,abs=.05)
        assert amount['bbox'][0]>=bar.x1-22-245-.05
        assert (amount['bbox'][1]+amount['bbox'][3])/2==pytest.approx(bar.y0+27,abs=.05)
