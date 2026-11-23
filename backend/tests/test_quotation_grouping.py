"""One commercial row per identical good, or per good in each physical room."""
from decimal import Decimal
import pymupdf
from test_workflow import client,setup


def ok(response):
    assert response.is_success,response.text
    return response.json()


def supplies(client):
    pid,base=setup(client);project=ok(client.get(f'/api/projects/{pid}'));types=ok(client.get('/api/types'))
    power=next(t for t in types if t['name']=='Блок питания LED-ленты')
    kitchen=ok(client.post(f'/api/projects/{pid}/rooms',json={'name':'Кухня'}))
    maker=ok(client.post('/api/manufacturers',json={'name':'Производитель блоков'}))
    product=ok(client.post('/api/products',json={'name':'Блок 24В 60Вт','sku':'PSU-60','manufacturer_id':maker['id'],'type_id':power['id'],'unit':'шт','price':450}))
    items=[]
    for index in range(6):
        room_id=base['room_id'] if index<3 else kitchen['id']
        tape=ok(client.post(f'/api/projects/{pid}/elements',json={**base,'room_id':room_id,'parameters':{'length':1+index*.25,'zone':str(index)}}))
        items.append(ok(client.post(f'/api/projects/{pid}/elements',json={**base,'room_id':room_id,'product_id':product['id'],'type_id':power['id'],'parameters':{'quantity':1,'power_watts':60,'led_strip_ids':[tape['id']]}})))
    return pid,items,product


def test_six_linked_supplies_become_one_then_one_per_room_and_back(client):
    pid,items,product=supplies(client);path=f'/api/projects/{pid}/quotation'
    report=ok(client.get(f'/api/projects/{pid}/report'))['rows']
    assert len([r for r in report if r['product_id']==product['id']])==6,'Specification must retain individual tape links'
    quote=ok(client.get(path));rows=[line for line in quote['lines'] if line['product_id']==product['id']]
    assert len(rows)==1 and Decimal(rows[0]['quantity'])==6
    assert set(rows[0]['source_ids'])=={item['id'] for item in items}
    rows[0].update(discount='10',comment='Общие условия');saved=ok(client.put(path,json=quote))
    before=saved['partner']['totals']
    split=ok(client.post(path+'/room-layout',json={'revision':saved['revision'],'layout':'rooms'}))
    rows=[line for line in split['lines'] if line['product_id']==product['id']]
    assert {line['room']:Decimal(line['quantity']) for line in rows}=={'Ванная':3,'Кухня':3}
    assert all(line['unit_price']=='450.00' and line['discount']=='10' and line['comment']=='Общие условия' for line in rows)
    assert split['partner']['totals']==before
    assert [line['room'] for line in split['lines']]==sorted([line['room'] for line in split['lines']],key=str.casefold)
    response=client.get(path+'/export.pdf?mode=partner')
    with pymupdf.open(stream=response.content,filetype='pdf') as pdf:
        text=' '.join(page.get_text() for page in pdf);assert text.count('PSU-60')==2 and 'Кухня' in text and 'Ванная' in text
    combined=ok(client.post(path+'/room-layout',json={'revision':split['revision'],'layout':'combined'}))
    rows=[line for line in combined['lines'] if line['product_id']==product['id']]
    assert len(rows)==1 and Decimal(rows[0]['quantity'])==6 and combined['partner']['totals']==before
    assert ok(client.get(path))==combined
    assert client.delete('/api/elements/'+str(items[-1]['id'])).status_code==204
    current=ok(client.get(path));assert Decimal(next(l for l in current['lines'] if l['product_id']==product['id'])['quantity'])==5
    ok(client.post(f'/api/projects/{pid}/elements/undo'))
    assert Decimal(next(l for l in ok(client.get(path))['lines'] if l['product_id']==product['id'])['quantity'])==6


def test_old_quotation_duplicates_merge_without_reimport_or_repricing(client):
    from app import main
    pid,items,product=supplies(client);path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path))
    template=next(line for line in quote['lines'] if line['product_id']==product['id'])
    with main.Session() as db:
        stored=db.get(main.Quotation,pid);others=[line for line in stored.content['lines'] if line['product_id']!=product['id']]
        duplicates=[{**template,'id':'old-'+str(i),'quantity':'1','calculated_quantity':'1','source_ids':[item['id']],'source_key':'elements:old-'+str(i),'source_signature':'','unit_price':'400','description':'Мощность, Вт: 60\nПитает ленты: LED-линия №'+str(i)} for i,item in enumerate(items)]
        stored.content={**stored.content,'lines':others+duplicates};db.commit()
    current=ok(client.get(path));rows=[line for line in current['lines'] if line['product_id']==product['id']]
    assert len(rows)==1 and Decimal(rows[0]['quantity'])==6 and Decimal(rows[0]['unit_price'])==400
    assert 'Питает ленты' not in rows[0]['description']
    assert rows[0]['id']=='old-0' and ok(client.get(path))==current


def test_manual_identical_rows_merge_on_save_and_keep_different_conditions(client):
    standalone=ok(client.post('/api/quotations',json={}));path='/api/quotations/'+str(standalone['id']);quote=standalone['quotation']
    quote['lines']=[{'id':str(i),'name':'Одинаковый товар','sku':'SKU-1','manufacturer':'Бренд','unit':'шт','quantity':1,'unit_price':100,'discount':10} for i in range(6)]
    saved=ok(client.put(path,json=quote));assert len(saved['lines'])==1 and Decimal(saved['lines'][0]['quantity'])==6
    assert saved['partner']['totals']['RUB']['total']=='540.00'
    assert saved['merged_line_ids']['5']==saved['lines'][0]['id']
    # Different agreed prices, discounts, articles, notes and manual room groups stay distinguishable.
    original=saved['lines'][0]
    for i,patch in enumerate(({'unit_price':200},{'discount':0},{'sku':'SKU-2'},{'comment':'Особые условия'},{'room':'Кухня'})):
        saved['lines'].append({**original,'id':'different-'+str(i),'quantity':1,**patch})
    current=ok(client.put(path,json=saved));assert len(current['lines'])==6
    assert ok(client.get(path))['lines']==current['lines']


def test_grouping_preserves_rounding_limits_and_independent_quantity_sources():
    from app.quotations import QuoteInput
    from app.quotation_grouping import merge_identical_lines
    def quote(**patch):return QuoteInput.model_validate({'global_discount':10,'lines':[{'id':str(i),'name':'Товар','quantity':1,'unit_price':'10.03',**patch} for i in range(2)]})
    rounded=quote();merge_identical_lines(rounded);assert len(rounded.lines)==2,'Keep negotiated totals when line rounding differs'
    limited=quote(quantity=600000,unit_price=100);merge_identical_lines(limited);assert len(limited.lines)==2
    mixed=quote(unit_price=100);mixed.lines[0].source_key='elements:1';mixed.lines[0].source_ids=[1]
    merge_identical_lines(mixed);assert len(mixed.lines)==2,'A manual addition must not vanish during future plan synchronization'
    unbound=QuoteInput.model_validate({'lines':[{'id':str(i),'source_key':'elements:'+str(i),'source_ids':[i+1],'type_id':1,'name':'Блок питания','quantity':1,'unit_price':100 if i==0 else 0,'description':'Мощность, Вт: 60\nПитает ленты: LED-линия №'+str(i)} for i in range(2)]})
    merge_identical_lines(unbound)
    assert len(unbound.lines)==1 and unbound.lines[0].quantity==2 and unbound.lines[0].unit_price==100


def test_grouping_applies_to_each_category_and_sums_metres(client):
    pid,base=setup(client);path=f'/api/projects/{pid}/quotation';types=ok(client.get('/api/types'));project=ok(client.get(f'/api/projects/{pid}'))
    other=ok(client.post(f'/api/projects/{pid}/rooms',json={'name':'Кухня'}))
    maker=ok(client.post('/api/manufacturers',json={'name':'Общий бренд'}));expected={};tape=None
    names=['LED-линия','Блок питания LED-ленты','Алюминиевый профиль','Движение','Электрокарниз','Zigbee диммер двухканальный','Люстра','Розетка одинарная']
    for name in names:
        kind=next(t for t in types if t['name']==name)
        product=ok(client.post('/api/products',json={'name':'Товар '+name,'sku':'SKU-'+str(kind['id']),'manufacturer_id':maker['id'],'type_id':kind['id'],'unit':kind['unit'],'price':100}))
        for i,room_id in enumerate((base['room_id'],base['room_id'],other['id'])):
            amount=Decimal('1.25') if kind['unit']=='м' else Decimal(1)
            parameters={'length' if kind['unit']=='м' else 'quantity':float(amount),'custom:Метка монтажа':str(i)}
            if name=='Блок питания LED-ленты':parameters['led_strip_ids']=[tape]
            item=ok(client.post(f'/api/projects/{pid}/elements',json={**base,'type_id':kind['id'],'layer_id':next(l['id'] for l in project['layers'] if l['name']==kind['category']),'product_id':product['id'],'room_id':room_id,'parameters':parameters}))
            if name=='LED-линия' and tape is None:tape=item['id']
        expected[product['id']]=amount
    quote=ok(client.get(path));assert len(quote['lines'])==len(names)
    assert all(Decimal(line['quantity'])==expected[line['product_id']]*3 for line in quote['lines'])
    split=ok(client.post(path+'/room-layout',json={'revision':quote['revision'],'layout':'rooms'}))
    assert len(split['lines'])==len(names)*2
    assert all(Decimal(line['quantity'])==expected[line['product_id']]*(2 if line['room']=='Ванная' else 1) for line in split['lines'])
    assert split['client']['totals']==quote['client']['totals']


def test_grouped_manual_quantity_can_refresh_and_requires_explicit_room_split(client):
    pid,_,product=supplies(client);path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path))
    line=next(line for line in quote['lines'] if line['product_id']==product['id']);line['quantity_override']='10'
    saved=ok(client.put(path,json=quote));refreshed=ok(client.post(path+'/import',json={'revision':saved['revision']}))
    assert Decimal(next(line for line in refreshed['lines'] if line['product_id']==product['id'])['quantity'])==10
    response=client.post(path+'/room-layout',json={'revision':refreshed['revision'],'layout':'rooms'})
    assert response.status_code==409 and 'Вручную' in response.json()['detail']
    assert ok(client.get(path))==refreshed
