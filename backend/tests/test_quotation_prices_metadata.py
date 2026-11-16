"""Known prices apply across the general CP; SKU and IP remain concise in both PDFs."""
from decimal import Decimal
import pymupdf
import pytest
from test_workflow import client
from test_quotation_room_layout import scene,ok
from app.quotations import QuoteInput,QuoteLine
from app.quotation_prices import inherit_prices
from app.quotation_pdf import export_quotation,item_details


def test_known_room_price_fills_other_rooms_and_combines_plan_sources(client):
    pid,_,_,items=scene(client);path=f'/api/projects/{pid}/quotation';doc=ok(client.get(path))
    doc=ok(client.post(path+'/room-layout',json={'revision':doc['revision'],'layout':'rooms'}))
    lights=[line for line in doc['lines'] if line['type_id']==items[0]['type_id']]
    lights[0].update(unit_price='150.25',overrides=['unit_price'])
    saved=ok(client.put(path,json=doc));assert sorted(Decimal(line['unit_price']) for line in saved['lines'] if line['type_id']==items[0]['type_id'])==[0,Decimal('150.25')]
    combined=ok(client.post(path+'/room-layout',json={'revision':saved['revision'],'layout':'combined'}))
    lights=[line for line in combined['lines'] if line['type_id']==items[0]['type_id']]
    assert len(lights)==1 and Decimal(lights[0]['quantity'])==5 and Decimal(lights[0]['unit_price'])==Decimal('150.25')
    assert set(lights[0]['source_ids'])=={items[0]['id'],items[1]['id']} and 'unit_price' in lights[0]['overrides']
    assert combined['client']['totals']['RUB']['total']=='751.25'
    split=ok(client.post(path+'/room-layout',json={'revision':combined['revision'],'layout':'rooms'}))
    assert all(Decimal(line['unit_price'])==Decimal('150.25') for line in split['lines'] if line['type_id']==items[0]['type_id'])


def test_general_price_ignores_rooms_comments_discounts_but_not_article_brand_unit_currency_or_ip(client):
    created=ok(client.post('/api/quotations',json={}));path='/api/quotations/'+str(created['id']);doc=created['quotation']
    base={'name':'Товар','sku':'SKU-100','manufacturer':'Завод','unit_price':'125.50','unit':'шт'}
    doc['lines']=[{'id':'priced',**base},*({'id':key,**base,'unit_price':'0',**patch} for key,patch in [
        ('copy',{'comment':'Свой комментарий','discount':'10'}),('article',{'sku':'SKU-101'}),('brand',{'manufacturer':'Другой'}),('unit',{'unit':'м'}),('currency',{'currency':'EUR'})])]
    saved=ok(client.put(path,json=doc));assert Decimal(saved['lines'][1]['unit_price'])==Decimal('125.50') and Decimal(saved['lines'][1]['discount'])==10
    assert all(Decimal(line['unit_price'])==0 for line in saved['lines'][2:])
    assert ok(client.get(path))==saved
    quote=QuoteInput(lines=[QuoteLine(id='a',name='Розетка',ip='20',description='IP20',unit_price=100),QuoteLine(id='b',name='Розетка',ip='44',description='IP44'),QuoteLine(id='c',name='Розетка',ip='IP20',description='IP20')])
    inherit_prices(quote);assert [line.unit_price for line in quote.lines]==[100,0,100]


def test_conflicting_prices_are_not_guessed_or_silently_overwritten(client):
    created=ok(client.post('/api/quotations',json={}));path='/api/quotations/'+str(created['id']);doc=created['quotation']
    doc['lines']=[{'id':str(i),'name':'Товар','sku':'SAME','unit_price':price} for i,price in enumerate((100,200,0))]
    saved=ok(client.put(path,json=doc));assert [Decimal(line['unit_price']) for line in saved['lines']]==[100,200,0]
    assert ok(client.get(path))==saved


@pytest.mark.parametrize('mode',['client','partner'])
def test_pdf_has_article_and_ip_immediately_under_name_without_labels(mode):
    quote=QuoteInput(lines=[QuoteLine(id='1',name='Контрольный светильник',sku='Артикул: LED-01',manufacturer='Завод',ip='IP65',description='Степень защиты: IP20\nМощность: 15 Вт',quantity=2,unit_price=100),QuoteLine(id='2',name='Лента',sku='SKU-TEST',description='Степень защиты: IP44',unit='м',quantity='2.5',unit_price=200)])
    with pymupdf.open(stream=export_quotation(quote,mode),filetype='pdf') as pdf:
        text=' '.join(page.get_text() for page in pdf)
    assert 'Артикул' not in text and 'Степень защиты' not in text
    assert 'LED-01 · IP65 · Завод' in text and 'SKU-TEST · IP44' in text and 'Мощность: 15 Вт' in text and 'IP20' not in text
    assert item_details(quote.lines[0]).splitlines()[1]=='LED-01 · IP65 · Завод'
    assert 'SKU 123' in item_details(QuoteLine(id='code',name='Товар',sku='SKU 123'))


def test_plan_ip_import_and_manual_ip_survive_refresh_and_export(client):
    pid,_,_,items=scene(client);path=f'/api/projects/{pid}/quotation';doc=ok(client.get(path))
    light=next(line for line in doc['lines'] if items[0]['id'] in line['source_ids']);assert light['ip']=='20'
    light.update(ip='IP44',sku='LIGHT-44',overrides=['ip','sku'])
    saved=ok(client.put(path,json=doc));refreshed=ok(client.post(path+'/import',json={'revision':saved['revision']}))
    light=next(line for line in refreshed['lines'] if items[0]['id'] in line['source_ids']);assert light['ip']=='IP44'
    response=client.get(path+'/export.pdf');assert response.is_success
    with pymupdf.open(stream=response.content,filetype='pdf') as pdf:
        text=' '.join(page.get_text() for page in pdf);assert 'LIGHT-44 · IP44' in text and 'Степень защиты' not in text
