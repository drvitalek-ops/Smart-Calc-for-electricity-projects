import base64
import io
from decimal import Decimal
import pytest
import pymupdf
from openpyxl import Workbook
from docx import Document
from test_workflow import client, setup
from app.main import pdf_font_path
from app.quotations import QuoteInput, QuoteLine, totals
from app.quotation_pdf import export_quotation
from app.quotation_import import parse_quote_file


def quote(client,pid):
    response=client.get(f'/api/projects/{pid}/quotation')
    assert response.status_code==200,response.text
    return response.json()


def put(client,pid,body):
    response=client.put(f'/api/projects/{pid}/quotation',json=body)
    assert response.status_code==200,response.text
    return response.json()


def test_exact_discounts_override_global_and_currencies_stay_separate():
    doc=QuoteInput(global_discount='10',lines=[
        QuoteLine(id='1',name='Розетка',quantity='2',unit_price='100'),
        QuoteLine(id='2',name='Диммер',quantity='3',unit_price='25.25',currency='EUR',discount='20'),
        QuoteLine(id='3',name='Без скидки',quantity='1',unit_price='10',discount='0'),
        QuoteLine(id='4',name='Округление',quantity='3',unit_price='.05'),
    ])
    client_view=totals(doc,'client');partner=totals(doc,'partner')
    assert client_view['totals']['RUB']['total']=='210.15'
    assert partner['totals']['RUB']['total']=='190.13'
    assert partner['totals']['EUR']['total']=='60.60'
    assert partner['lines'][2]['discount_amount']=='0.00'
    assert partner['lines'][3]['discount_amount']=='0.02'
    assert doc.global_discount==Decimal('10') and doc.lines[1].discount==Decimal('20')


def test_quote_persistence_pdf_variants_and_conflicts(client):
    pid,_=setup(client)
    initial=quote(client,pid)
    body={**initial,'number':'10574','customer':'Надежда дизайнер','global_discount':'20',
          'lines':[{'id':'manual','name':'Настенный светильник','quantity':'10','unit':'шт','unit_price':'100','currency':'RUB'}]}
    saved=put(client,pid,body)
    assert saved['client']['totals']['RUB']['total']=='1000.00'
    assert saved['partner']['totals']['RUB']['total']=='800.00'
    assert quote(client,pid)==saved
    assert client.put(f'/api/projects/{pid}/quotation',json=body).status_code==409
    for mode,expected in [('client','1 000,00'),('partner','800,00')]:
        response=client.get(f'/api/projects/{pid}/quotation/export.pdf?mode={mode}')
        assert response.status_code==200 and response.content.startswith(b'%PDF')
        with pymupdf.open(stream=response.content,filetype='pdf') as pdf:
            content=' '.join(' '.join(page.get_text() for page in pdf).split())
            assert expected in content and '10574' in content and 'Надежда дизайнер' in content
            assert ('СКИДКА' in content)==(mode=='partner')
            assert ('Скидка:' in content)==(mode=='partner')
    assert quote(client,pid)==saved,'PDF export must not remove or mutate saved discounts'


def test_catalog_creation_binds_calculated_elements_atomically(client):
    pid,body=setup(client)
    eid=client.post(f'/api/projects/{pid}/elements',json=body).json()['id']
    initial=quote(client,pid)
    line=initial['lines'][0]
    assert line['source_ids']==[eid] and line['quantity']=='3.5'
    response=client.post(f'/api/projects/{pid}/quotation/product',json={
        'revision':initial['revision'],'line_id':line['id'],'type_id':body['type_id'],
        'name':'Лента премиум','manufacturer':'Завод тест','sku':'LED-001','unit_price':'120.50','currency':'RUB'})
    assert response.status_code==201,response.text
    saved=response.json();product_id=saved['lines'][0]['product_id']
    current=client.get(f'/api/projects/{pid}').json()
    assert current['elements'][0]['product_id']==product_id
    report=client.get(f'/api/projects/{pid}/report').json()['rows'][0]
    assert report['product']=='Лента премиум' and report['total']==421.75
    catalog=client.get('/api/catalog').json()
    assert next(product for product in catalog['products'] if product['id']==product_id)['manufacturer']=='Завод тест'
    assert saved['client']['totals']['RUB']['total']=='421.75'
    client.patch(f"/api/layers/{body['layer_id']}",json={'locked':True})
    before=client.get('/api/catalog').json()
    denied=client.post(f'/api/projects/{pid}/quotation/product',json={
        'revision':saved['revision'],'line_id':line['id'],'type_id':body['type_id'],
        'name':'Не должен создаться','manufacturer':'Новый завод','unit_price':'200'})
    assert denied.status_code==409
    assert client.get('/api/catalog').json()==before
    assert quote(client,pid)==saved


def test_reimport_is_idempotent_preserves_discounts_manual_rows_and_backup(client):
    pid,body=setup(client)
    eid=client.post(f'/api/projects/{pid}/elements',json=body).json()['id']
    initial=quote(client,pid)
    original_id=initial['lines'][0]['id']
    initial['global_discount']='15';initial['lines'][0]['discount']='0';initial['lines'][0]['unit_price']='10'
    initial['lines'].append({'id':'extra','name':'Доставка','quantity':'1','unit_price':'500'})
    saved=put(client,pid,initial)
    body['parameters']={**body['parameters'],'length':5.5}
    assert client.put(f'/api/elements/{eid}',json=body).status_code==200
    for _ in range(2):
        response=client.post(f'/api/projects/{pid}/quotation/import',json={'revision':saved['revision']})
        assert response.status_code==200,response.text
        saved=response.json()
        assert len(saved['lines'])==2 and saved['lines'][0]['id']==original_id
        assert saved['lines'][0]['quantity']=='5.5' and saved['lines'][0]['discount']=='0'
    backup=client.get(f'/api/projects/{pid}/backup')
    restored=client.post('/api/projects/import',files={'file':('project.zip',backup.content,'application/zip')})
    assert restored.status_code==201,restored.text
    new_id=restored.json()['id'];copied=quote(client,new_id)
    assert copied['global_discount']=='15' and len(copied['lines'])==2
    assert copied['client']['totals']==saved['client']['totals']
    new_elements=client.get(f'/api/projects/{new_id}').json()['elements']
    assert copied['lines'][0]['source_ids']==[new_elements[0]['id']]
    assert copied['lines'][0]['source_ids']!=[eid]
    assert client.delete(f'/api/projects/{pid}').status_code==200
    assert client.get(f'/api/projects/{pid}/quotation').status_code==404
    assert quote(client,new_id)['lines'][0]['name']==saved['lines'][0]['name']


def test_quotes_validate_financial_values_and_images(client):
    pid,_=setup(client)
    initial=quote(client,pid)
    line={'id':'row','name':'Тест','quantity':'1','unit_price':'100'}
    for bad in ({'discount':'101'},{'discount':'-1'},{'quantity':'0'},{'unit_price':'NaN'},{'unit_price':'-1'},
                {'image':'data:image/png;base64,bm90IGFuIGltYWdl'}):
        assert client.put(f'/api/projects/{pid}/quotation',json={**initial,'lines':[{**line,**bad}]}).status_code==422
    pix=pymupdf.Pixmap(pymupdf.csRGB,pymupdf.IRect(0,0,3,3));pix.clear_with(255)
    image='data:image/png;base64,'+base64.b64encode(pix.tobytes('png')).decode()
    saved=put(client,pid,{**initial,'lines':[{**line,'image':image}]})
    assert saved['lines'][0]['image']==image


def test_pdf_pagination_and_external_pdf_price_quantity_roundtrip():
    lines=[QuoteLine(id=str(i),name='Светильник номер '+str(i),quantity=str(i+1),unit_price='1234.50',sku='SKU-'+str(i)) for i in range(20)]
    doc=QuoteInput(number='10574',customer='Заказчик проекта',lines=lines,global_discount='10')
    data=export_quotation(doc,'client',pdf_font_path())
    with pymupdf.open(stream=data,filetype='pdf') as pdf:
        assert len(pdf)>1
        print('QUOTE_PDF_PREVIEW='+base64.b64encode(pdf[0].get_pixmap(matrix=pymupdf.Matrix(.85,.85)).tobytes('png')).decode())
        text=' '.join(' '.join(page.get_text() for page in pdf).split())
        assert 'Светильник номер 19' in text
    result=parse_quote_file(data,'КП.pdf')
    assert len(result['lines'])==20,result
    assert [Decimal(line['quantity']) for line in result['lines']]==[Decimal(i+1) for i in range(20)]
    assert all(Decimal(line['unit_price'])==Decimal('1234.50') for line in result['lines'])


def test_external_excel_word_csv_import_is_preview_only(client):
    pid,_=setup(client)
    before=quote(client,pid)
    workbook=Workbook();sheet=workbook.active
    sheet.append(['Коммерческое предложение'])
    sheet.append(['Наименование','Цена','Кол-во','Ед.','Артикул'])
    sheet.append(['Настенный светильник','25 904,00 ₽',1,'шт','A-1'])
    sheet.append(['Лента','185,50',4,'м','LED-2'])
    sheet.append(['Итого','26646,00',5])
    stream=io.BytesIO();workbook.save(stream)
    response=client.post(f'/api/projects/{pid}/quotation/import-file',files={'file':('Товары.xlsx',stream.getvalue(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')})
    assert response.status_code==200,response.text
    imported=response.json()['lines']
    assert len(imported)==2 and imported[0]['unit_price']=='25904.00' and imported[1]['quantity']=='4.000'
    assert imported[1]['unit']=='м' and imported[0]['sku']=='A-1'
    assert quote(client,pid)==before,'Upload must not overwrite the saved quotation'
    document=Document();table=document.add_table(rows=1,cols=4)
    for cell,value in zip(table.rows[0].cells,['Наименование','Цена','Количество','Ед.']): cell.text=value
    for cell,value in zip(table.add_row().cells,['Подвес','1 000,50','2','шт']): cell.text=value
    stream=io.BytesIO();document.save(stream)
    word=parse_quote_file(stream.getvalue(),'КП.docx')
    assert word['lines'][0]['name']=='Подвес' and word['lines'][0]['unit_price']=='1000.50'
    csv=parse_quote_file('Наименование;Цена;Кол-во\\nРозетка;125,50;3\\n'.replace('\\n','\n').encode(),'КП.csv')
    assert csv['lines'][0]['quantity']=='3.000' and csv['lines'][0]['unit_price']=='125.50'


def test_external_import_rejects_scans_unsupported_and_invalid_documents():
    with pymupdf.open() as document:
        document.new_page()
        data=document.tobytes()
    with pytest.raises(ValueError,match='сканы'): parse_quote_file(data,'скан.pdf')
    with pytest.raises(ValueError,match='docx'): parse_quote_file(b'old word','old.doc')
    with pytest.raises(ValueError): parse_quote_file(b'broken','broken.xlsx')
