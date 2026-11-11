"""Editable CP comments, room groups and order must survive every save/refresh."""
import pymupdf
from decimal import Decimal
from test_workflow import client,setup
from app.quotations import QuoteInput,QuoteLine
from app.quotation_pdf import export_quotation
from app.quotation_import import parse_quote_file


def checked(response):
    assert response.is_success,response.text
    return response.json()


def test_standalone_order_groups_comments_prices_and_both_pdfs(client):
    created=checked(client.post('/api/quotations',json={}))
    path='/api/quotations/'+str(created['id'])
    doc=created['quotation'];doc['global_discount']='10'
    doc['lines']=[{'id':'b','name':'Бра над кроватью','room':'Спальня','comment':'Выключатель справа','quantity':'2','unit_price':'100'},
                  {'id':'a','name':'Лента в нише','room':'Кухня','comment':'Подключить через диммер','quantity':'3.5','unit':'м','unit_price':'200'}]
    saved=checked(client.put(path,json=doc));assert [line['id'] for line in saved['lines']]==['b','a']
    assert checked(client.get(path))==saved
    assert saved['client']['totals']['RUB']['total']=='900.00' and saved['partner']['totals']['RUB']['total']=='810.00'
    for mode in ('client','partner'):
        response=client.get(path+'/export.pdf?mode='+mode);assert response.status_code==200
        with pymupdf.open(stream=response.content,filetype='pdf') as pdf:
            text=' '.join(page.get_text() for page in pdf)
            assert text.index('Спальня')<text.index('Бра над кроватью')<text.index('Кухня')<text.index('Лента в нише')
            assert 'Выключатель справа' in text and 'Подключить через диммер' in text
    invalid={**saved,'lines':[{**saved['lines'][0],'comment':'x'*2001}]}
    assert client.put(path,json=invalid).status_code==422
    assert checked(client.get(path))==saved


def test_plan_refresh_preserves_manual_room_comment_and_interleaved_order(client):
    pid,body=setup(client)
    a=checked(client.post(f'/api/projects/{pid}/elements',json=body))
    room=checked(client.post(f'/api/projects/{pid}/rooms',json={'name':'Вторая комната'}))
    b=checked(client.post(f'/api/projects/{pid}/elements',json={**body,'room_id':room['id'],'x':.7}))
    path=f'/api/projects/{pid}/quotation';doc=checked(client.get(path))
    first=next(line for line in doc['lines'] if a['id'] in line['source_ids'])
    second=next(line for line in doc['lines'] if b['id'] in line['source_ids'])
    second.update(room='Спальня заказчика',comment='Оставить запас кабеля',overrides=['room'])
    doc['lines']=[{'id':'manual','name':'Монтаж','quantity':'1','unit_price':'500','room':'Работы','comment':'По согласованию'},second,first]
    saved=checked(client.put(path,json=doc))
    checked(client.put('/api/elements/'+str(a['id']),json={**a,'parameters':{**a['parameters'],'length':6}}))
    extra_room=checked(client.post(f'/api/projects/{pid}/rooms',json={'name':'Новая комната'}))
    c=checked(client.post(f'/api/projects/{pid}/elements',json={**body,'room_id':extra_room['id'],'x':.9}))
    refreshed=checked(client.post(path+'/import',json={'revision':saved['revision']}))
    assert [line['id'] for line in refreshed['lines'][:3]]==['manual',second['id'],first['id']]
    assert refreshed['lines'][3]['source_ids']==[c['id']]
    assert refreshed['lines'][1]['room']=='Спальня заказчика' and refreshed['lines'][1]['comment']=='Оставить запас кабеля'
    assert Decimal(refreshed['lines'][2]['quantity'])==6
    plan=checked(client.get(f'/api/projects/{pid}'))
    assert next(item for item in plan['elements'] if item['id']==b['id'])['room_id']==room['id']
    product=checked(client.post(path+'/product',json={'revision':refreshed['revision'],'line_id':second['id'],'type_id':body['type_id'],'name':'Лента с товаром','manufacturer':'Завод групп','unit_price':'100'}))
    result=checked(client.post(path+'/import',json={'revision':product['revision']}))
    row=next(line for line in result['lines'] if line['id']==second['id'])
    assert row['room']=='Спальня заказчика' and row['comment']=='Оставить запас кабеля'
    assert [line['id'] for line in result['lines'][:3]]==['manual',second['id'],first['id']]


def test_comments_survive_calculated_row_split_and_merge(client):
    pid,body=setup(client)
    a=checked(client.post(f'/api/projects/{pid}/elements',json=body))
    b=checked(client.post(f'/api/projects/{pid}/elements',json={**body,'x':.7}))
    path=f'/api/projects/{pid}/quotation';doc=checked(client.get(path))
    assert len(doc['lines'])==1
    doc['lines'][0]['comment']='Общий комментарий'
    saved=checked(client.put(path,json=doc))
    room=checked(client.post(f'/api/projects/{pid}/rooms',json={'name':'Вторая'}))
    changed=checked(client.put('/api/elements/'+str(b['id']),json={**b,'room_id':room['id']}))
    split=checked(client.post(path+'/import',json={'revision':saved['revision']}))
    assert len(split['lines'])==2 and all(line['comment']=='Общий комментарий' for line in split['lines'])
    split['lines'][0]['comment']='Первый комментарий';split['lines'][1]['comment']='Второй комментарий'
    split['lines'][0]['discount']='0';split['lines'][1]['discount']='10'
    saved=checked(client.put(path,json=split))
    checked(client.put('/api/elements/'+str(b['id']),json={**changed,'room_id':body['room_id']}))
    assert client.post(path+'/import',json={'revision':saved['revision']}).status_code==409
    assert checked(client.get(path))==saved
    for line in saved['lines']:line['discount']='10'
    saved=checked(client.put(path,json=saved))
    merged=checked(client.post(path+'/import',json={'revision':saved['revision']}))
    assert len(merged['lines'])==1
    assert merged['lines'][0]['comment']=='Первый комментарий\nВторой комментарий'
    assert Decimal(merged['lines'][0]['discount'])==10


def test_group_headers_repeat_on_continuations_and_pdf_import_keeps_prices():
    quote=QuoteInput(number='GROUPS',lines=[QuoteLine(id=str(i),name='Позиция '+str(i+1),room='Гостиная',comment='Монтировать по проекту',quantity='2',unit_price='1234.50') for i in range(40)])
    data=export_quotation(quote,'client')
    with pymupdf.open(stream=data,filetype='pdf') as document:
        assert len(document)>=3
        for page in document:
            text=page.get_text()
            if 'Позиция' in text:assert 'Гостиная' in text
    parsed=parse_quote_file(data,'grouped.pdf')
    assert len(parsed['lines'])==40,parsed
    assert all(Decimal(line['quantity'])==2 and Decimal(line['unit_price'])==Decimal('1234.50') for line in parsed['lines'])
