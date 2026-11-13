"""The approved font increase is exactly 5% and applies to PDF tables only."""
import pymupdf
import pytest
import app.quotation_pdf as renderer
from app.quotation_pdf import export_quotation
from app.quotations import QuoteInput,QuoteLine


@pytest.mark.parametrize('mode',['client','partner'])
def test_table_fonts_grow_five_percent_without_changing_branding_or_totals(mode,monkeypatch):
    quote=QuoteInput(number='ТЕСТ',customer='Покупатель',lines=[QuoteLine(id='row',name='Светильник для проверки',sku='SKU-TEST',manufacturer='Бренд',room='Прихожая',comment='Проверочный комментарий',quantity=2,unit_price='11060')])
    with monkeypatch.context() as context:
        context.setattr(renderer,'TABLE_TEXT_SCALE',1.0)
        with pymupdf.open(stream=export_quotation(quote,mode),filetype='pdf') as before:
            old_spans=[span for page in before for block in page.get_text('dict')['blocks'] for line in block.get('lines',[]) for span in line['spans']]
            unchanged={label:next(span['size'] for span in old_spans if label in span['text']) for label in ('Включая НДС','Покупатель')}
    with pymupdf.open(stream=export_quotation(quote,mode),filetype='pdf') as document:
        spans=[span for page in document for block in page.get_text('dict')['blocks'] for line in block.get('lines',[]) for span in line['spans']]
        def font(text):return next(span['size'] for span in spans if text in span['text'])
        assert font('НАИМЕНОВАНИЕ')==pytest.approx(5.775,abs=.001)
        assert font('Светильник для проверки')==pytest.approx(7.875,abs=.001)
        assert font('SKU-TEST')==pytest.approx(7.875,abs=.001)
        assert font('Проверочный комментарий')==pytest.approx(7.875,abs=.001)
        assert font('Прихожая')==pytest.approx(8.925,abs=.001)
        amount=next(span for span in spans if span['text']=='22 120,00 ₽' and span['size']>15)
        assert amount['size']==pytest.approx(27,abs=.001)
        assert font('Включая НДС')==pytest.approx(unchanged['Включая НДС'],abs=.001)
        assert font('Покупатель')==pytest.approx(unchanged['Покупатель'],abs=.001)
        for page in document:
            for block in page.get_text('dict')['blocks']:
                for line in block.get('lines',[]):
                    for span in line['spans']:
                        assert -1<=span['bbox'][0]<span['bbox'][2]<=page.rect.width+1
