"""Word SKU exports are editable quantity-only documents, independent of prices."""
import io
import zipfile
from decimal import Decimal
from docx import Document
from test_workflow import client,setup


def ok(response):
    assert response.is_success,response.text
    return response.json()


def table(response):
    assert response.status_code==200,response.text[:500] if response.status_code!=200 else ''
    assert response.headers['content-type']=='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    assert '.docx' in response.headers['content-disposition']
    document=Document(io.BytesIO(response.content))
    assert len(document.tables)==1
    return document,[[cell.text for cell in row.cells] for row in document.tables[0].rows]


def test_saved_and_draft_standalone_word_have_only_names_quantities_and_units(client):
    created=ok(client.post('/api/quotations',json={}))
    path='/api/quotations/'+str(created['id']);quote=created['quotation']
    quote.update(number='С-1',global_discount='17.25',customer='КЛИЕНТ_СЕКРЕТ',terms='УСЛОВИЯ_СЕКРЕТ')
    quote['lines']=[{'id':'b','name':'Лента & профиль <24 В>','quantity':'2.5','unit':'м','unit_price':'98765.43','discount':'13.37','description':'ОПИСАНИЕ_СЕКРЕТ','comment':'КОММЕНТАРИЙ_СЕКРЕТ'},
                    {'id':'a','name':'Светильник','quantity':'1000','unit_price':'87654.32'}]
    saved=ok(client.put(path,json=quote))
    response=client.get(path+'/sku.docx');document,rows=table(response)
    assert rows==[['№','Наименование','Количество','Ед.'],['1','Лента & профиль <24 В>','2,5','м'],['2','Светильник','1000','шт']]
    assert document.tables[0].rows[0]._tr.xpath('./w:trPr/w:tblHeader')
    assert abs(document.sections[0].page_width.mm-210)<.1
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        xml=''.join(archive.read(name).decode() for name in archive.namelist() if name.endswith('.xml'))
    for private in ('98765.43','87654.32','17.25','13.37','КЛИЕНТ_СЕКРЕТ','УСЛОВИЯ_СЕКРЕТ','ОПИСАНИЕ_СЕКРЕТ','КОММЕНТАРИЙ_СЕКРЕТ','Цена','Скидка','Сумма','₽'):
        assert private not in xml
    # The draft export accepts only its own fields, regardless of unfinished prices.
    payload={'number':'Черновик','global_discount':'bad-discount','lines':[{'id':'a','name':'Новое название','quantity':'1,125','unit':'м','unit_price':'bad-price'}]}
    _,draft=table(client.post(path+'/sku.docx',json=payload))
    assert draft[1]==['1','Новое название','1,125','м']
    assert client.get(path).json()==saved


def test_linked_draft_word_uses_latest_plan_counts_and_explicit_manual_quantity(client):
    pid,body=setup(client)
    element=ok(client.post(f'/api/projects/{pid}/elements',json=body))
    path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path))
    original=quote['lines'][0];original['unit_price']='98765.43'
    saved=ok(client.put(path,json=quote))
    ok(client.put('/api/elements/'+str(element['id']),json={**body,'parameters':{**body['parameters'],'length':8}}))
    _,rows=table(client.get(path+'/sku.docx'));assert rows[1][2:] == ['8','м']
    original['name']='Название из несохранённых правок'
    _,rows=table(client.post(path+'/sku.docx',json={'number':'Черновик','lines':[original]}))
    assert rows[1][1:] == ['Название из несохранённых правок','8','м']
    original['quantity_override']='12,75'
    _,rows=table(client.post(path+'/sku.docx',json={'lines':[original]}))
    assert rows[1][2:] == ['12,75','м']
    current=ok(client.get(path));assert current['revision']==saved['revision']
    assert current['lines'][0]['name']!=original['name'] and Decimal(current['lines'][0]['quantity'])==8
    assert Decimal(current['lines'][0]['unit_price'])==Decimal('98765.43')
    assert client.delete('/api/elements/'+str(element['id'])).status_code==204
    result=client.post(path+'/sku.docx',json={'lines':[original]})
    assert result.status_code==422 and 'Добавьте позиции' in result.json()['detail']


def test_word_export_validates_quantities_names_duplicates_scope_and_empty_lists(client):
    created=ok(client.post('/api/quotations',json={}))
    path='/api/quotations/'+str(created['id'])+'/sku.docx'
    assert client.get(path).status_code==422
    assert client.post(path,json={'lines':[]}).status_code==422
    for bad in ('','0','-1','1,0001','not-a-number','1000001'):
        response=client.post(path,json={'lines':[{'id':'a','name':'Товар','quantity':bad}]})
        assert response.status_code==422,(bad,response.text)
        assert response.json()['detail'][0]['field']=='Строка КП № 1 — Количество'
    for name in ('','   '):
        assert client.post(path,json={'lines':[{'id':'a','name':name,'quantity':1}]}).status_code==422
    body={'lines':[{'id':'a','name':'Товар','quantity':1}]}
    assert client.post('/api/quotations/999999/sku.docx',json=body).status_code==404
    assert client.post('/api/projects/999999/quotation/sku.docx',json=body).status_code==404
    assert client.post(path,json={'lines':body['lines']*2}).status_code==422
    forbidden={**body['lines'][0],'source_key':'elements:abc','source_ids':[1]}
    assert client.post(path,json={'lines':[forbidden]}).status_code==422


def test_large_sku_keeps_order_and_does_not_truncate_after_editor_page(client):
    created=ok(client.post('/api/quotations',json={}))
    lines=[{'id':str(index),'name':'Позиция '+str(index),'quantity':'1','unit':'шт'} for index in range(1,251)]
    _,rows=table(client.post('/api/quotations/'+str(created['id'])+'/sku.docx',json={'lines':lines}))
    assert len(rows)==251 and rows[1][1]=='Позиция 1' and rows[-1][1]=='Позиция 250'
