"""Exercise v1.0.42 -> current -> v1.0.42 on a disposable desktop database.

Usage: python scripts/check-rollback-compatibility.py --previous /path/to/v1.0.42
No application databases or credentials are used.
"""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def canonical(value):
    if isinstance(value,list):return [canonical(item) for item in value]
    if isinstance(value,dict):
        # Plan synchronization metadata is new in v62. Older applications ignore
        # it; compare all actual rows, sources and commercial terms unchanged.
        result={key:canonical(item) for key,item in value.items() if key not in ('catalog_links_version','catalog_link_issues','last_worked_page_id','view_settings','plan_frame_snapshot_ids','excluded_frame_ids','source_frame_ids','frame_variant','frame_ids','frame_product_explicit','frame_sources','source_signature','room_layout','plan_sync','plan_snapshot_ids','excluded_plan_ids','plan_frame_snapshot_keys','excluded_frame_keys') and not (key in ('comment','ip') and item=='' or key=='hidden_groups' and item==[] or key=='active' and item is True and set(value).issubset({'id','name','active'}) or key=='style' and item in ({},{'font':'Golos','table_scale':1,'colors':{}}))}
        # Working-page/display metadata is new in v70; older versions ignore it.
        # v46 intentionally replaces the old identical yellow fixture defaults.
        seed=result.get('seed_key') or ''
        if result.get('category')=='Освещение' and seed.startswith('Освещение:') and str(result.get('color','')).lower()=='#facc15':
            palette=json.loads((Path(__file__).resolve().parents[1]/'backend/app/assets/plan-symbols.json').read_text())['lighting_colors']
            result['color']=palette.get(seed.split(':',1)[1],result['color'])
        return result
    return value


def run_stage(stage, root):
    import pymupdf
    from fastapi.testclient import TestClient
    from app.main import app

    def checked(response):
        assert response.is_success, (response.status_code, response.text[:1000])
        return response.json()

    with TestClient(app) as client:
        def get(path):return checked(client.get('/api'+path))
        def post(path, data):return checked(client.post('/api'+path,json=data))
        if stage=='seed':
            project=post('/projects',{'name':'Проверка обратной совместимости'})
            pid=project['id']
            plan=pymupdf.open();plan.new_page(width=1000,height=700);plan.new_page(width=700,height=1000)
            pages=checked(client.post(f'/api/projects/{pid}/pdf',files={'file':('plan.pdf',plan.tobytes(),'application/pdf')}))
            project=get(f'/projects/{pid}');types=get('/types')
            room=post(f'/projects/{pid}/rooms',{'name':'Гостиная','wet':False,'page_id':pages[0]['id'],'polygon':[{'x':0,'y':0},{'x':1,'y':0},{'x':1,'y':1},{'x':0,'y':1}]})
            checked(client.post(f"/api/pages/{pages[0]['id']}/calibrate",json={'x1':.1,'y1':.1,'x2':.6,'y2':.1,'real_length_mm':5000}))
            maker=post('/manufacturers',{'name':'Завод для проверки'})
            supplier=post('/suppliers',{'name':'Поставщик','contact':'info@example.test'})
            custom=post('/categories',{'name':'Пользовательская категория','description':'Не теряется после отката'})
            post('/types',{'name':'Своя позиция','category':custom['name'],'unit':'шт','color':'#123456','defaults':{'quantity':1,'custom:Протокол':'DALI'}})
            strip_ids=[];electrical=[]
            for index,kind in enumerate(types):
                if kind['name']=='Блок питания LED-ленты':continue
                layer=next(row for row in project['layers'] if row['name']==kind['category'])
                parameters={**kind['defaults'],'plan_color':kind['color'],'custom:Проверено':True}
                geometry={}
                if kind['unit']=='м':
                    geometry={'points':[{'x':.1,'y':.2},{'x':.6,'y':.2}]}
                    parameters.update(length=5,manual_length=5.25)
                element=post(f'/projects/{pid}/elements',{'page_id':pages[0]['id'],'layer_id':layer['id'],'type_id':kind['id'],'room_id':room['id'],'x':.1+(index%9)*.09,'y':.2+(index//9)*.08,'parameters':parameters,'geometry':geometry})
                if kind['name']=='LED-линия':strip_ids.append(element['id'])
                if kind['name'] in ('Розетка одинарная','Розетка с USB (2 в 1)'):electrical.append(element['id'])
            strip=next(kind for kind in types if kind['name']=='LED-линия')
            first=next(row for row in get(f'/projects/{pid}')['elements'] if row['id']==strip_ids[0])
            second=post(f'/projects/{pid}/elements',{**first,'x':.7,'geometry':{},'parameters':{'length':3.25,'power_watts':30}})
            power=next(kind for kind in types if kind['name']=='Блок питания LED-ленты')
            post(f'/projects/{pid}/elements',{'page_id':pages[1]['id'],'layer_id':first['layer_id'],'type_id':power['id'],'x':.3,'y':.3,'parameters':{'led_strip_ids':[first['id'],second['id']],'power_watts':120}})
            post(f'/projects/{pid}/frames',{'element_ids':electrical,'posts':len(electrical)})
            quote=get(f'/projects/{pid}/quotation')
            photo=pymupdf.Pixmap(pymupdf.csRGB,pymupdf.IRect(0,0,4,4),False);photo.clear_with(180)
            quote=post(f'/projects/{pid}/quotation/product',{'revision':quote['revision'],'line_id':quote['lines'][0]['id'],'type_id':quote['lines'][0]['type_id'],'name':'Товар с фотографией','manufacturer':'Завод для проверки','sku':'PHOTO-01','unit_price':'1234.56','image':'data:image/png;base64,'+base64.b64encode(photo.tobytes('png')).decode()})
            quote.update(number='КП-совместимость',global_discount='12.5',customer='Клиент')
            checked(client.put(f'/api/projects/{pid}/quotation',json=quote))
            standalone=post('/quotations',{})
            doc=standalone['quotation'];doc['lines']=[{'id':'manual','name':'Профиль','unit':'м','quantity':'2.375','unit_price':'350.50','discount':'7.5'}]
            checked(client.put('/api/quotations/'+str(standalone['id']),json=doc))
            (root/'ids.json').write_text(json.dumps({'project':pid,'quote':standalone['id']}))
        ids=json.loads((root/'ids.json').read_text());pid=ids['project']
        project=get(f'/projects/{pid}');project.pop('history',None)
        capture={'project':project,'report':get(f'/projects/{pid}/report'),'catalog':get('/catalog'),'types':get('/types'),'quote':get(f'/projects/{pid}/quotation'),'standalone':get('/quotations/'+str(ids['quote']))}
        # v65 adds library entries, without changing any placed legacy objects.
        additions={'Шинопровод','Трековый светильник','Трековый линейный светильник','Трековый спот','Трековый подвес','Блок питания трека','Соединитель трека прямой','Соединитель трека угловой','Соединитель трека Т-образный','Соединитель трека гибкий','Ввод питания трека','Заглушка трека','Подвес трека','Крепление трека'}
        added=[item for item in capture['types'] if item.get('seed_key')=='Освещение:'+item['name'] and item['name'] in additions]
        capture['types']=[item for item in capture['types'] if item not in added]
        for category in capture['catalog'].get('categories',[]):
            if category['name']=='Освещение':category['positions']-=len(added)
        capture=canonical(capture)
        expected=root/'expected.json'
        if stage=='seed':expected.write_text(json.dumps(capture,ensure_ascii=False,sort_keys=True))
        else:
            previous=json.loads(expected.read_text())
            for key,value in capture.items():assert value==previous[key], f'{stage}: changed {key}'
        if stage=='current':
            first=project['elements'][0]
            checked(client.patch(f'/api/projects/{pid}/elements/appearance',json={'element_ids':[first['id']],'changes':{'plan_icon':'R','plan_shape':'diamond','plan_size':1.25,'plan_rotation':30}}))
            checked(client.post(f'/api/projects/{pid}/elements/undo'))
            checked(client.post(f'/api/projects/{pid}/elements/redo'))
            quote=get(f'/projects/{pid}/quotation');quote['lines'][0]['discount']='17.5'
            checked(client.put(f'/api/projects/{pid}/quotation',json=quote))
            project=get(f'/projects/{pid}');project.pop('history',None)
            capture.update(project=project,quote=get(f'/projects/{pid}/quotation'))
            capture=canonical(capture)
            expected.write_text(json.dumps(capture,ensure_ascii=False,sort_keys=True))
        # Every version must open plans, export all reports and retain discounts.
        for path in (f'/projects/{pid}/export/pdf',f'/projects/{pid}/export/xlsx',f"/projects/{pid}/pages/{project['pages'][0]['id']}/export.pdf",f"/pages/{project['pages'][0]['id']}/image",f'/projects/{pid}/quotation/export.pdf?mode=partner',f"/quotations/{ids['quote']}/export.pdf?mode=client"):
            response=client.get('/api'+path);assert response.is_success and len(response.content)>100, (stage,path)
        # Compare the unchanged template at the legacy table font size. The approved
        # +5% table typography and its pagination are checked by dedicated PDF tests.
        from app.quotations import QuoteInput,QuoteLine
        from app.quotation_pdf import export_quotation
        reference=QuoteInput(number='10574',date='2026-09-25',customer='Надежда дизайнер',global_discount='10',lines=[QuoteLine(id=str(i),name=f'Светильник для проекта {i+1}',quantity='2.5',unit_price='1234.56',sku=f'LED-{i:03}') for i in range(65)])
        pdf=export_quotation(reference,'partner')
        import app.quotation_pdf as pdf_renderer
        scale=getattr(pdf_renderer,'TABLE_TEXT_SCALE',None)
        try:
            if scale is not None:pdf_renderer.TABLE_TEXT_SCALE=1.0
            baseline_pdf=export_quotation(reference,'partner')
        finally:
            if scale is not None:pdf_renderer.TABLE_TEXT_SCALE=scale
        with pymupdf.open(stream=baseline_pdf,filetype='pdf') as document:
            digests=[]
            for index,page in enumerate(document):
                pixmap=page.get_pixmap(matrix=pymupdf.Matrix(1,1),alpha=False)
                if index==0:pixmap.set_rect(pymupdf.IRect(32,340,563,410),(255,255,255))
                digests.append(hashlib.sha256(pixmap.samples).hexdigest())
        pixels=root/'layout.json'
        if stage=='seed':pixels.write_text(json.dumps(digests))
        else:assert digests==json.loads(pixels.read_text()),f'{stage}: CP layout pixels changed outside totals'
        if stage!='seed':
            imported=checked(client.post(f'/api/projects/{pid}/quotation/import-file',files={'file':('reference.pdf',pdf,'application/pdf')}))
            assert len(imported['lines'])==65,(stage,len(imported['lines']))
            assert all(line['unit_price']=='1234.56' and line['quantity']=='2.500' for line in imported['lines'])
        print(f'PASS {stage}: {len(project["elements"])} objects, frames, multi-strip supply, metres, custom category, photos, both CPs, reports and stable CP template at baseline table font')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--previous',type=Path)
    parser.add_argument('--stage',choices=('seed','current','previous'))
    parser.add_argument('--data',type=Path)
    args=parser.parse_args()
    if args.stage:
        run_stage(args.stage,args.data);return
    if not args.previous or not (args.previous/'backend/app/main.py').is_file():parser.error('--previous must point to v1.0.42 sources')
    current=Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix='smart-calc-compatibility-') as temporary:
        root=Path(temporary);storage=root/'storage';storage.mkdir()
        for stage,source in [('seed',args.previous),('current',current),('previous',args.previous)]:
            environment={**os.environ,'DATABASE_URL':'sqlite:///'+str(root/'smart-home-calc.db'),'STORAGE_DIR':str(storage),'AUTO_CREATE_SCHEMA':'1','PYTHONPATH':str(source/'backend')}
            subprocess.run([sys.executable,str(Path(__file__).resolve()),'--stage',stage,'--data',str(root)],cwd=source,env=environment,check=True,timeout=180)


if __name__=='__main__':main()
