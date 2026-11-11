"""A linked CP follows plan counts/metres without rewriting negotiated terms."""
from decimal import Decimal
import io
import zipfile
import json
import pymupdf
from test_workflow import client,setup


def ok(response):
    assert response.is_success,response.text
    return response.json()


def test_counts_metres_add_delete_and_undo_preserve_terms_without_import(client):
    pid,body=setup(client)
    element=ok(client.post(f'/api/projects/{pid}/elements',json=body))
    path=f'/api/projects/{pid}/quotation'
    quote=ok(client.get(path));line=quote['lines'][0]
    line.update(unit_price='100',discount='20',comment='Не менять',room='Моя группа',overrides=['room','unit_price'])
    saved=ok(client.put(path,json=quote));line_id=saved['lines'][0]['id']
    changed={**body,'parameters':{**body['parameters'],'length':8}}
    ok(client.put('/api/elements/'+str(element['id']),json=changed))
    current=ok(client.get(path));line=current['lines'][0]
    assert Decimal(line['quantity'])==8 and Decimal(line['calculated_quantity'])==8
    assert (line['id'],line['room'],line['comment'],line['unit_price'],line['discount'])==(line_id,'Моя группа','Не менять','100','20')
    assert current['partner']['totals']['RUB']['total']=='640.00'
    second=ok(client.post(f'/api/projects/{pid}/elements',json={**body,'x':.8}))
    current=ok(client.get(path));assert len(current['lines'])==1
    assert Decimal(current['lines'][0]['quantity'])==Decimal('11.5')
    assert set(current['lines'][0]['source_ids'])=={element['id'],second['id']}
    assert client.delete('/api/elements/'+str(element['id'])).status_code==204
    assert Decimal(ok(client.get(path))['lines'][0]['quantity'])==Decimal('3.5')
    assert client.delete('/api/elements/'+str(second['id'])).status_code==204
    assert ok(client.get(path))['lines']==[]
    ok(client.post(f'/api/projects/{pid}/elements/undo'))
    line=ok(client.get(path))['lines'][0]
    # Reads must not discard the saved row's price when the last source disappears.
    assert line['unit_price']=='100' and line['discount']=='20' and line['comment']=='Не менять'
    ok(client.post(f'/api/projects/{pid}/elements/undo'))
    assert Decimal(ok(client.get(path))['lines'][0]['quantity'])==Decimal('11.5')


def test_stale_save_and_pdf_preview_export_backup_use_current_plan_quantity(client):
    pid,body=setup(client);element=ok(client.post(f'/api/projects/{pid}/elements',json=body))
    path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path))
    quote['lines'][0]['unit_price']='100';quote=ok(client.put(path,json=quote))
    changed={**body,'parameters':{**body['parameters'],'length':8}}
    ok(client.put('/api/elements/'+str(element['id']),json=changed))
    # The editor may still hold a document loaded before the plan was changed.
    for response in (client.get(path+'/export.pdf?mode=client'),client.post(path+'/preview.pdf?mode=client',json=quote)):
        assert response.status_code==200,response.text
        with pymupdf.open(stream=response.content,filetype='pdf') as document:
            text=' '.join(page.get_text() for page in document)
            assert '800,00' in text and '350,00' not in text
    backup=client.get(f'/api/projects/{pid}/backup')
    with zipfile.ZipFile(io.BytesIO(backup.content)) as archive:
        manifest=json.loads(archive.read('manifest.json'))
    assert Decimal(manifest['quotation']['lines'][0]['quantity'])==8
    quote['lines'][0]['comment']='Правка старого окна'
    saved=ok(client.put(path,json=quote))
    assert Decimal(saved['lines'][0]['quantity'])==8 and saved['lines'][0]['comment']=='Правка старого окна'


def test_merging_plan_groups_does_not_merge_negotiated_prices_or_duplicate_manual_quantity(client):
    pid,body=setup(client)
    a=ok(client.post(f'/api/projects/{pid}/elements',json=body))
    different={**body,'x':.8,'parameters':{**body['parameters'],'ip':44}}
    b=ok(client.post(f'/api/projects/{pid}/elements',json=different))
    path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path))
    assert len(quote['lines'])==2
    for index,line in enumerate(quote['lines']):
        line.update(unit_price=str(100+index*100),discount=str(index*10),comment='Строка '+str(index))
    quote['lines'][0]['quantity_override']='9'
    saved=ok(client.put(path,json=quote));expected={line['id']:line for line in saved['lines']}
    ok(client.put('/api/elements/'+str(b['id']),json={**body,'x':.8}))
    ok(client.put('/api/elements/'+str(a['id']),json={**body,'parameters':{**body['parameters'],'length':7}}))
    current=ok(client.get(path))
    assert [line['id'] for line in current['lines']]==[line['id'] for line in saved['lines']]
    for line in current['lines']:
        old=expected[line['id']]
        assert (line['unit_price'],line['discount'],line['comment'])==(old['unit_price'],old['discount'],old['comment'])
        calculated=Decimal('7') if a['id'] in line['source_ids'] else Decimal('3.5')
        assert Decimal(line['calculated_quantity'])==calculated
        assert Decimal(line['quantity'])==(Decimal('9') if old['quantity_override'] else calculated)


def test_new_unlinked_types_and_manual_quotes_remain_independent(client):
    pid,body=setup(client);ok(client.post(f'/api/projects/{pid}/elements',json=body))
    path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path))
    kinds=ok(client.get('/api/types'));kind=next(item for item in kinds if item['name']=='Люстра')
    project=ok(client.get(f'/api/projects/{pid}'));layer=next(item for item in project['layers'] if item['name']=='Освещение')
    ok(client.post(f'/api/projects/{pid}/elements',json={**body,'layer_id':layer['id'],'type_id':kind['id'],'parameters':{'quantity':3,'ip':20}}))
    first=ok(client.get(path));second=ok(client.get(path))
    assert first==second and len(first['lines'])==1
    # Adding new nomenclature to the CP remains an explicit action.
    assert first['lines'][0]['type_id']==body['type_id']
    standalone=ok(client.post('/api/quotations',json={}))
    document=standalone['quotation'];document['lines']=[{'id':'manual','name':'Своя позиция','quantity':'13','unit_price':'100'}]
    saved=ok(client.put('/api/quotations/'+str(standalone['id']),json=document))
    attached=ok(client.post('/api/quotations/'+str(standalone['id'])+'/attach',json={'revision':saved['revision'],'project_id':pid,'project_revision':quote['revision']}))
    assert len(attached['quotation']['lines'])==1 and attached['quotation']['lines'][0]['quantity']=='13'
    assert ok(client.get(path))['lines']==attached['quotation']['lines']


def test_piece_counts_and_frames_follow_plan_and_keep_bound_product_price(client):
    pid,body=setup(client)
    kinds=ok(client.get('/api/types'));kind=next(item for item in kinds if item['name']=='Розетка одинарная')
    project=ok(client.get(f'/api/projects/{pid}'));layer=next(item for item in project['layers'] if item['name']=='Электроустановки')
    common={**body,'layer_id':layer['id'],'type_id':kind['id'],'parameters':{'quantity':1,'ip':20}}
    objects=[ok(client.post(f'/api/projects/{pid}/elements',json={**common,'x':.1+i*.2})) for i in range(4)]
    for pair in (objects[:2],objects[2:]):
        ok(client.post(f'/api/projects/{pid}/frames',json={'element_ids':[item['id'] for item in pair],'posts':2}))
    path=f'/api/projects/{pid}/quotation';quote=ok(client.get(path))
    socket=next(line for line in quote['lines'] if line['type_id']==kind['id'])
    product=ok(client.post(path+'/product',json={'revision':quote['revision'],'line_id':socket['id'],'type_id':kind['id'],'name':'Выбранная розетка','manufacturer':'Завод','unit_price':'100'}))
    catalogue=ok(client.get('/api/catalog'));bound=next(item for item in catalogue['products'] if item['id']==product['lines'][0]['product_id'])
    ok(client.put('/api/products/'+str(bound['id']),json={**bound,'price':900}))
    # Quantity changes must not silently pull new catalogue prices into an agreed CP.
    original=ok(client.get(f'/api/projects/{pid}'))['elements'][0]
    ok(client.put('/api/elements/'+str(original['id']),json={**original,'parameters':{**original['parameters'],'quantity':5}}))
    current=ok(client.get(path));socket=next(line for line in current['lines'] if line['type_id']==kind['id'])
    assert Decimal(socket['quantity'])==8 and Decimal(socket['unit_price'])==100
    frames=next(line for line in current['lines'] if line['source_key'].startswith('frame:'))
    assert Decimal(frames['quantity'])==2
    assert client.delete('/api/elements/'+str(original['id'])).status_code==204
    current=ok(client.get(path));frames=next(line for line in current['lines'] if line['source_key'].startswith('frame:'))
    assert Decimal(frames['quantity'])==1
    ok(client.post(f'/api/projects/{pid}/elements/undo'))
    assert Decimal(next(line for line in ok(client.get(path))['lines'] if line['source_key'].startswith('frame:'))['quantity'])==2
