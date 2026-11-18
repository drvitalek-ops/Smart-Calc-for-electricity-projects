import pymupdf
import pytest
from pydantic import ValidationError
from app.quotations import QuoteInput
from app.quotation_pdf import export_quotation
from test_workflow import client


def document(style=None):
    return QuoteInput(number='СТИЛЬ',style=style or {},customer='Тестовый заказчик',lines=[{'id':'one','name':'Светильник тестовый','sku':'TEST-01','quantity':'2','unit_price':'1000'}])


@pytest.mark.parametrize('font',['Golos','DejaVuSans','DejaVuSerif'])
def test_theme_fonts_preserve_cyrillic_and_totals(font):
    data=export_quotation(document({'font':font,'table_scale':1.2,'colors':{'total_amount':'#123456','table_name':'#654321','header':'#102030'}}),'client')
    with pymupdf.open(stream=data,filetype='pdf') as pdf:
        text=''.join(page.get_text() for page in pdf)
        assert 'Светильник тестовый' in text and '2 000,00' in text
        assert any(span['color']==0x123456 for page in pdf for block in page.get_text('dict')['blocks'] if 'lines' in block for line in block['lines'] for span in line['spans'])
        assert all(0<=word[0]<word[2]<=page.rect.width for page in pdf for word in page.get_text('words'))


@pytest.mark.parametrize('style',[{'font':'../../system'},{'table_scale':50},{'colors':{'total_amount':'red'}},{'colors':{'unknown':'#123456'}}])
def test_invalid_theme_is_rejected(style):
    with pytest.raises(ValidationError):document(style)


def test_theme_saved_and_preview_uses_export_renderer(client):
    created=client.post('/api/quotations',json={}).json();qid=created['id']
    quote=client.get(f'/api/quotations/{qid}').json();quote['style']={'font':'DejaVuSerif','table_scale':1.1,'colors':{'total_amount':'#123456'}}
    saved=client.put(f'/api/quotations/{qid}',json=quote)
    assert saved.status_code==200,saved.text
    restored=client.get(f'/api/quotations/{qid}').json()
    assert restored['style']==quote['style']
    response=client.post(f'/api/quotations/{qid}/preview.png?mode=client&page=1',json=restored)
    assert response.status_code==200 and response.content.startswith(b'\x89PNG')
