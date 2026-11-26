"""A frame's goods and finish belong to the whole frame, never its devices."""
from decimal import Decimal
import io
import pymupdf
from docx import Document
from test_workflow import client,setup
from app import main


def ok(response):
    assert response.is_success,response.text
    return response.json()


def scene(client):
    pid,base=setup(client);project=ok(client.get(f'/api/projects/{pid}'))
    socket=next(t for t in ok(client.get('/api/types')) if t['name']=='Розетка одинарная')
    layer=next(l for l in project['layers'] if l['name']=='Электроустановки')
    kitchen=ok(client.post(f'/api/projects/{pid}/rooms',json={'name':'Кухня'}))
    groups=[];points=[]
    for index,(room,posts) in enumerate([(base['room_id'],2),(base['room_id'],2),(kitchen['id'],2),(kitchen['id'],1)]):
        members=[ok(client.post(f'/api/projects/{pid}/elements',json={**base,'type_id':socket['id'],'layer_id':layer['id'],'room_id':room,'x':.2+j*.1,'y':.2+index*.1,'parameters':{'quantity':1,'ip':20}})) for j in range(posts)]
        groups.append(ok(client.post(f'/api/projects/{pid}/frames',json={'element_ids':[item['id'] for item in members],'posts':posts}))['frame_group']);points.append(members)
    return pid,groups,points,layer


def frames(quote):return [line for line in quote['lines'] if line['source_key'].startswith('frame:')]


def test_manual_frame_colors_group_in_both_layouts_and_exports(client):
    pid,groups,points,_=scene(client);path=f'/api/projects/{pid}';qpath=path+'/quotation'
    before=ok(client.get(qpath))
    for group,color in zip(groups,['Белый','Чёрный',' белый  ','Белый']):ok(client.patch(path+'/frames/'+group,json={'color':color}))
    current=ok(client.get(qpath));items=frames(current)
    assert len(items)==3 and sorted(Decimal(line['quantity']) for line in items)==[1,1,2]
    assert {line['frame_variant'] for line in items}=={'color:2:белый','color:2:черный','color:1:белый'}
    assert len({gid for line in items for gid in line['source_frame_ids']})==4
    split=ok(client.post(qpath+'/room-layout',json={'revision':current['revision'],'layout':'rooms'}))
    assert len(frames(split))==4 and sum(Decimal(line['quantity']) for line in frames(split))==4
    assert {line['room'] for line in frames(split)}=={'Кухня','Ванная'}
    combined=ok(client.post(qpath+'/room-layout',json={'revision':split['revision'],'layout':'combined'}))
    assert len(frames(combined))==3 and ok(client.get(qpath))==combined
    report=ok(client.get(path+'/report'));rows=[row for row in report['rows'] if row['category']=='Рамки']
    assert len(rows)==4 and sum(row['quantity'] for row in rows)==4
    pdf=client.get(qpath+'/export.pdf');assert pdf.status_code==200
    with pymupdf.open(stream=pdf.content,filetype='pdf') as document:
        text=' '.join(page.get_text() for page in document);assert 'Белый' in text and 'Чёрный' in text
    payload={'number':'Тест','room_layout':'combined','lines':combined['lines'],'plan_frame_snapshot_keys':combined['plan_frame_snapshot_keys']}
    response=client.post(qpath+'/sku.docx',json=payload);assert response.status_code==200,response.text
    assert 'Белый' in '\n'.join(cell.text for table in Document(io.BytesIO(response.content)).tables for row in table.rows for cell in row.cells)
    # One Undo restores the entire last frame, not just one member.
    ok(client.post(path+'/elements/undo'));actual=ok(client.get(path))['elements']
    assert all('frame_color' not in item['parameters'] for item in actual if item['parameters'].get('frame_group')==groups[3])
    ok(client.post(path+'/elements/redo'));assert len(frames(ok(client.get(qpath))))==3
    assert all(item['product_id'] is None for item in actual)


def test_frame_product_is_independent_preserves_agreed_prices_and_transfers_without_cp(client):
    pid,groups,points,layer=scene(client);path=f'/api/projects/{pid}';qpath=path+'/quotation'
    kind=ok(client.post('/api/types',json={'category':'Рамки','name':'Рамка двухпостовая','unit':'шт','defaults':{'frame_posts':2}}))
    maker=ok(client.post('/api/manufacturers',json={'name':'Завод рамок'}))
    product=ok(client.post('/api/products',json={'name':'Рамка графит','sku':'FRAME-02-GR','type_id':kind['id'],'manufacturer_id':maker['id'],'unit':'шт','price':250,'parameters':{'color':'Графит'}}))
    for group in groups[:3]:ok(client.patch(path+'/frames/'+group,json={'product_id':product['id']}))
    actual=ok(client.get(path))['elements'];assert all(item['product_id'] is None for item in actual)
    assert all(item['parameters']['frame_product_id']==product['id'] for item in actual if item['parameters'].get('frame_group') in groups[:3])
    # Goods must be present in ZIP even when no CP has ever been saved.
    backup=client.get(path+'/backup');copied=ok(client.post('/api/projects/import',files={'file':('frame.zip',backup.content,'application/zip')}))
    copy=ok(client.get('/api/projects/'+str(copied['id'])));assert sum('frame_product_id' in e['parameters'] for e in copy['elements'])==6
    quote=ok(client.get(qpath));bound=next(line for line in frames(quote) if line['product_id']==product['id'])
    assert Decimal(bound['quantity'])==3 and bound['sku']=='FRAME-02-GR'
    bound.update(unit_price='199',overrides=['unit_price']);quote=ok(client.put(qpath,json=quote))
    ok(client.put('/api/products/'+str(product['id']),json={**product,'price':500}))
    current=ok(client.get(qpath));assert Decimal(next(line for line in frames(current) if line['product_id'])['unit_price'])==199
    split=ok(client.post(qpath+'/room-layout',json={'revision':current['revision'],'layout':'rooms'}))
    assert sorted(Decimal(line['quantity']) for line in frames(split) if line['product_id'])==[1,2]
    assert all(Decimal(line['unit_price'])==199 for line in frames(split) if line['product_id'])
    # Clearing only one physical frame splits it back into its manual-color group.
    ok(client.patch(path+'/frames/'+groups[0],json={'product_id':None,'color':'Белый'}))
    current=ok(client.get(qpath));white=next(line for line in frames(current) if line['frame_variant']=='color:2:белый')
    assert white['product_id'] is None and white['source_frame_ids']==[groups[0]]
    # Undo restores the previous physical assignment and existing CP price.
    ok(client.post(path+'/elements/undo'));current=ok(client.get(qpath))
    assert sum(Decimal(line['quantity']) for line in frames(current) if line['product_id']==product['id'])==3
    assert all(Decimal(line['unit_price'])==199 for line in frames(current) if line['product_id'])
    assert client.patch(path+'/frames/'+groups[3],json={'product_id':product['id']}).status_code==422
    ok(client.patch('/api/layers/'+str(layer['id']),json={'locked':True}))
    assert client.patch(path+'/frames/'+groups[0],json={'color':'Красный'}).status_code==409


def test_legacy_frame_links_recover_colors_without_duplicate_or_lost_prices(client):
    pid,groups,_,_=scene(client);path=f'/api/projects/{pid}';qpath=path+'/quotation'
    quote=ok(client.get(qpath))
    for line in frames(quote):line['unit_price']='77';line['discount']='10'
    quote=ok(client.put(qpath,json=quote))
    with main.Session() as db:
        stored=db.get(main.Quotation,pid);content={**stored.content}
        lines=[]
        for original in content['lines']:
            line={key:value for key,value in original.items() if key not in ('source_frame_ids','frame_variant')}
            if line['source_key'].startswith('frame:'):line['source_key']='frame::'+line['source_key'].rsplit(':',1)[-1]
            lines.append(line)
        content['lines']=lines;stored.content=content;db.commit()
    ok(client.patch(path+'/frames/'+groups[1],json={'color':'Черный'}))
    current=ok(client.get(qpath));assert sum(Decimal(line['quantity']) for line in frames(current))==4
    assert len(frames(current))==3 and all(Decimal(line['unit_price'])==77 for line in frames(current))
    assert all(Decimal(line['discount'])==10 for line in frames(current))
    assert ok(client.get(qpath))==current


def test_different_colors_merge_by_explicit_goods_and_guard_manual_count(client):
    pid,groups,_,_=scene(client);path=f'/api/projects/{pid}';qpath=path+'/quotation'
    for group,color in zip(groups,['Белый','Черный','БЕЛЫЙ','Белый']):ok(client.patch(path+'/frames/'+group,json={'color':color}))
    maker=ok(client.post('/api/manufacturers',json={'name':'Единая база рамок'}))
    product=ok(client.post('/api/products',json={'name':'Рамка универсальная','sku':'FR-2','manufacturer_id':maker['id'],'unit':'шт','price':350}))
    quote=ok(client.get(qpath));white=next(line for line in frames(quote) if line['frame_variant']=='color:2:белый')
    white['quantity_override']='5';saved=ok(client.put(qpath,json=quote))
    response=client.patch(path+'/frames/'+groups[0],json={'color':'Бежевый'})
    assert response.status_code==409 and 'Вручную' in response.json()['detail']
    assert ok(client.get(qpath))==saved
    white=next(line for line in frames(saved) if line['frame_variant']=='color:2:белый');white['quantity_override']=None
    ok(client.put(qpath,json=saved))
    # Different manual finishes no longer split a single explicitly selected SKU.
    for group in groups[:3]:ok(client.patch(path+'/frames/'+group,json={'product_id':product['id']}))
    current=ok(client.get(qpath));bound=[line for line in frames(current) if line['product_id']==product['id']]
    assert len(bound)==1 and Decimal(bound[0]['quantity'])==3
    # Refresh from calculation must also retain agreed terms.
    bound[0]['unit_price']='299';bound[0]['discount']='12';current=ok(client.put(qpath,json=current))
    current=ok(client.post(qpath+'/import',json={'revision':current['revision']}))
    bound=next(line for line in frames(current) if line['product_id']==product['id'])
    assert Decimal(bound['unit_price'])==299 and Decimal(bound['discount'])==12
    backup=client.get(path+'/backup');assert backup.status_code==200
    # A modified catalogue record forces a new product ID while importing the ZIP.
    ok(client.put('/api/products/'+str(product['id']),json={**product,'price':400}))
    copied=ok(client.post('/api/projects/import',files={'file':('frame.zip',backup.content,'application/zip')}))
    copied_quote=ok(client.get('/api/projects/'+str(copied['id'])+'/quotation'))
    copied_bound=next(line for line in frames(copied_quote) if line['sku']=='FR-2')
    assert copied_bound['product_id']!=product['id'] and copied_bound['frame_variant']=='product:'+str(copied_bound['product_id'])
    assert Decimal(copied_bound['quantity'])==3 and Decimal(copied_bound['unit_price'])==299
    copied_plan=ok(client.get('/api/projects/'+str(copied['id'])))
    assert sum(item['parameters'].get('frame_product_id')==copied_bound['product_id'] for item in copied_plan['elements'])==6


def test_omitted_physical_frames_stay_omitted_after_color_change(client):
    pid,groups,_,_=scene(client);path=f'/api/projects/{pid}';qpath=path+'/quotation'
    ok(client.patch(path+'/frames/'+groups[0],json={'color':'Белый'}))
    ok(client.patch(path+'/frames/'+groups[1],json={'color':'Черный'}))
    quote=ok(client.get(qpath));quote['lines']=[line for line in quote['lines'] if groups[1] not in line['source_frame_ids']]
    quote=ok(client.put(qpath,json=quote))
    assert sum(Decimal(line['quantity']) for line in frames(quote))==3
    ok(client.patch(path+'/frames/'+groups[1],json={'color':'Белый'}))
    current=ok(client.get(qpath));assert sum(Decimal(line['quantity']) for line in frames(current))==3
    assert all(groups[1] not in line['source_frame_ids'] for line in current['lines'])
    # A newly created frame is a new plan source, even with the same finish.
    plan=ok(client.get(path));template=plan['elements'][0]
    members=[ok(client.post(path+'/elements',json={**template,'x':.6+i*.1,'parameters':{'quantity':1,'ip':20}})) for i in range(2)]
    new=ok(client.post(path+'/frames',json={'element_ids':[item['id'] for item in members],'posts':2}))
    ok(client.patch(path+'/frames/'+new['frame_group'],json={'color':'Белый'}))
    current=ok(client.get(qpath));assert sum(Decimal(line['quantity']) for line in frames(current))==4
    assert any(new['frame_group'] in line['source_frame_ids'] for line in current['lines'])
    split=ok(client.post(qpath+'/room-layout',json={'revision':current['revision'],'layout':'rooms'}))
    assert sum(Decimal(line['quantity']) for line in frames(split))==4
    assert all(groups[1] not in line['source_frame_ids'] for line in split['lines'])


def test_legacy_omission_migrates_even_when_excluded_frame_changes_finish(client):
    pid,groups,_,_=scene(client);path=f'/api/projects/{pid}';qpath=path+'/quotation'
    quote=ok(client.get(qpath));quote=ok(client.post(qpath+'/room-layout',json={'revision':quote['revision'],'layout':'rooms'}))
    quote['lines']=[line for line in quote['lines'] if groups[2] not in line['source_frame_ids']]
    ok(client.put(qpath,json=quote))
    with main.Session() as db:
        stored=db.get(main.Quotation,pid)
        content={key:value for key,value in stored.content.items() if key not in ('plan_frame_snapshot_ids','excluded_frame_ids')}
        content['lines']=[{key:value for key,value in line.items() if key not in ('source_frame_ids','frame_variant')} for line in content['lines']]
        for line in content['lines']:
            if line['source_key'].startswith('frame:'):line['source_key']='frame:'+line['room']+':'+line['source_key'].rsplit(':',1)[-1]
        stored.content=content;db.commit()
    ok(client.patch(path+'/frames/'+groups[2],json={'color':'Графит'}))
    quote=ok(client.get(qpath));assert sum(Decimal(line['quantity']) for line in frames(quote))==3
    assert groups[2] in quote['excluded_frame_ids']
    assert all(groups[2] not in line['source_frame_ids'] for line in quote['lines'])


def test_frame_graphic_color_is_separate_from_cp_grouping_and_exported_to_plan(client):
    pid,groups,_,_=scene(client);path=f'/api/projects/{pid}';qpath=path+'/quotation'
    for group,color in zip(groups,['#5b21b6','#dc2626','#16a34a','#2563eb']):ok(client.patch(path+'/frames/'+group,json={'color':'Белый','plan_color':color}))
    quote=ok(client.get(qpath));assert sorted(Decimal(line['quantity']) for line in frames(quote))==[1,3]
    assert {line['frame_variant'] for line in frames(quote)}=={'color:2:белый','color:1:белый'}
    report=ok(client.get(path+'/report'));assert all('frame_plan_color' not in row['parameters'] for row in report['rows'])
    plan=ok(client.get(path));page=plan['pages'][0]
    response=client.get(path+'/pages/'+str(page['id'])+'/export.pdf');assert response.status_code==200
    with pymupdf.open(stream=response.content,filetype='pdf') as doc:
        colors=[drawing.get('color') for drawing in doc[0].get_drawings()]
        for expected in [(91/255,33/255,182/255),(220/255,38/255,38/255)]:assert any(color and all(abs(a-b)<.001 for a,b in zip(color,expected)) for color in colors)
    assert client.patch(path+'/frames/'+groups[0],json={'plan_color':'not-a-color'}).status_code==422
    assert ok(client.get(path))['elements']==plan['elements']
    # One Undo restores the whole last frame, including the graphic color.
    ok(client.post(path+'/elements/undo'));actual=ok(client.get(path))['elements']
    assert all('frame_plan_color' not in item['parameters'] for item in actual if item['parameters'].get('frame_group')==groups[-1])
    backup=client.get(path+'/backup');copied=ok(client.post('/api/projects/import',files={'file':('colors.zip',backup.content,'application/zip')}))
    restored=ok(client.get('/api/projects/'+str(copied['id'])))
    assert {item['parameters'].get('frame_plan_color') for item in restored['elements']}=={None,'#5b21b6','#dc2626','#16a34a'}


def test_manual_frame_color_names_are_resolved_consistently(client):
    from app.frame_goods import plan_color
    assert plan_color({'frame_color':'Чёрный матовый'})=='#20262c'
    assert plan_color({'frame_color':' Белый  '})=='#f8fafc'
    assert plan_color({'frame_plan_color':'#5B21B6','frame_color':'Белый'})=='#5b21b6'
    assert plan_color({},'Графит')=='#475569'
