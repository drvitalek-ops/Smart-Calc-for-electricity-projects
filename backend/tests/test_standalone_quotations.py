import io
import json
import os
import sqlite3
import subprocess
import sys
from decimal import Decimal
import pytest
import pymupdf
from test_workflow import client, setup


def draft(client):
    response=client.post('/api/quotations',json={})
    assert response.status_code==201,response.text
    return response.json()


def saved(client,qid,body):
    response=client.put(f'/api/quotations/{qid}',json=body)
    assert response.status_code==200,response.text
    return response.json()


def test_create_standalone_without_creating_any_project(client):
    created=draft(client);qid=created['id'];doc=created['quotation']
    assert doc['revision']==1 and doc['lines']==[]
    assert client.get('/api/projects').json()==[]
    assert client.get(f'/api/quotations/{qid}').json()==doc
    assert client.get('/api/quotations/project-options').json()==[]
    listing=client.get('/api/quotations').json()
    assert [row['id'] for row in listing['standalone']]==[qid] and listing['projects']==[]
    changed=saved(client,qid,{**doc,'number':'КП-10575','customer':'Клиент без проекта','global_discount':'15',
        'lines':[{'id':'manual','name':'Светильник','quantity':'3','unit_price':'100','discount':'20'}]})
    assert changed['client']['totals']['RUB']['total']=='300.00'
    assert changed['partner']['totals']['RUB']['total']=='240.00'
    assert client.get(f'/api/quotations/{qid}').json()==changed
    assert client.get('/api/projects').json()==[]
    for mode in ('client','partner'):
        pdf=client.get(f'/api/quotations/{qid}/export.pdf?mode={mode}')
        assert pdf.status_code==200 and pdf.content.startswith(b'%PDF')
    stale=client.put(f'/api/quotations/{qid}',json=doc)
    assert stale.status_code==409


def test_standalone_and_project_namespaces_remain_independent(client):
    created=draft(client);qid=created['id']
    pid,_=setup(client)
    project_quote=client.get(f'/api/projects/{pid}/quotation').json()
    assert qid==pid,'Fixture should exercise colliding IDs in different tables'
    changed=saved(client,qid,{**created['quotation'],'customer':'Самостоятельное КП'})
    assert client.get(f'/api/projects/{pid}/quotation?qid={qid}').json()==project_quote
    assert client.get(f'/api/quotations/{qid}?pid={pid}').json()==changed
    body={**changed,'lines':[{'id':'bad','name':'Тест','source_ids':[999],'source_key':'elements:test'}]}
    assert client.put(f'/api/quotations/{qid}',json=body).status_code==422
    assert client.get(f'/api/projects/{pid}/quotation').json()==project_quote


def test_standalone_catalog_and_external_import_work_before_attachment(client):
    created=draft(client);qid=created['id']
    doc=saved(client,qid,{**created['quotation'],'lines':[{'id':'manual','name':'Новая розетка','quantity':'2','unit_price':'100'}]})
    typ=next(row for row in client.get('/api/types').json() if row['name']=='Розетка одинарная')
    response=client.post(f'/api/quotations/{qid}/product',json={'revision':doc['revision'],'line_id':'manual',
        'type_id':typ['id'],'name':'Розетка из КП','manufacturer':'Тестовый завод','unit_price':'120.50'})
    assert response.status_code==201,response.text
    doc=response.json();product_id=doc['lines'][0]['product_id']
    assert next(product for product in client.get('/api/catalog').json()['products'] if product['id']==product_id)['name']=='Розетка из КП'
    assert doc['client']['totals']['RUB']['total']=='241.00'
    preview=client.post(f'/api/quotations/{qid}/preview',json={**doc,'global_discount':'50'})
    assert preview.status_code==200 and preview.json()['partner']['totals']['RUB']['total']=='120.50'
    imported=client.post(f'/api/quotations/{qid}/import-file',files={'file':('external.csv','Наименование;Цена;Кол-во\nЛампа;25,00;4\n'.encode(),'text/csv')})
    assert imported.status_code==200,imported.text
    assert imported.json()['lines'][0]['unit_price']=='25.00'
    assert client.get(f'/api/quotations/{qid}').json()==doc
    assert client.get('/api/projects').json()==[]


def test_attach_moves_quote_without_changing_its_content_or_plan(client):
    created=draft(client);qid=created['id']
    doc=saved(client,qid,{**created['quotation'],'number':'Свой номер','customer':'До привязки','global_discount':'12.5',
        'terms':'Доставка включена','lines':[{'id':'manual','name':'Лента','quantity':'4.5','unit':'м','unit_price':'150','discount':'0'}]})
    pid,body=setup(client)
    client.post(f'/api/projects/{pid}/elements',json=body)
    project_before=client.get(f'/api/projects/{pid}').json()
    option=next(row for row in client.get('/api/quotations/project-options').json() if row['id']==pid)
    assert option['quote_revision']==0
    response=client.post(f'/api/quotations/{qid}/attach',json={'revision':doc['revision'],'project_id':pid,'project_revision':0})
    assert response.status_code==200,response.text
    assert response.json()['archived_quotation_id'] is None
    linked=client.get(f'/api/projects/{pid}/quotation').json()
    assert {k:v for k,v in linked.items() if k!='revision'}=={k:v for k,v in doc.items() if k!='revision'}
    assert client.get(f'/api/quotations/{qid}').status_code==404
    assert client.get(f'/api/projects/{pid}').json()==project_before
    listing=client.get('/api/quotations').json()
    assert listing['standalone']==[] and listing['projects'][0]['project_id']==pid


def test_attach_preserves_old_project_quote_as_a_standalone_copy(client):
    pid,body=setup(client);client.post(f'/api/projects/{pid}/elements',json=body)
    old=client.get(f'/api/projects/{pid}/quotation').json()
    old['lines'][0]['unit_price']='333';old['lines'][0]['discount']='25'
    response=client.put(f'/api/projects/{pid}/quotation',json=old)
    assert response.status_code==200;old=response.json()
    created=draft(client);qid=created['id'];new=saved(client,qid,{**created['quotation'],'customer':'Новое КП',
        'lines':[{'id':'new','name':'Новая позиция','quantity':'5','unit_price':'100'}]})
    response=client.post(f'/api/quotations/{qid}/attach',json={'revision':new['revision'],'project_id':pid,'project_revision':old['revision']})
    assert response.status_code==200,response.text
    archived_id=response.json()['archived_quotation_id'];assert archived_id and archived_id!=qid
    archive=client.get(f'/api/quotations/{archived_id}').json()
    assert archive['client']['totals']==old['client']['totals'] and archive['partner']['totals']==old['partner']['totals']
    assert archive['number']==old['number'] and archive['customer']==old['customer']
    assert all(not line['source_ids'] and not line['source_key'] for line in archive['lines'])
    assert client.get(f'/api/projects/{pid}/quotation').json()['customer']=='Новое КП'
    assert client.delete(f'/api/projects/{pid}').status_code==200
    assert client.get(f'/api/quotations/{archived_id}').status_code==200


def test_attach_rejects_stale_revisions_and_missing_projects_atomically(client):
    pid,_=setup(client);target=client.get(f'/api/projects/{pid}/quotation').json()
    created=draft(client);qid=created['id'];doc=created['quotation']
    for patch,status in [({'project_revision':target['revision']-1},409),({'revision':0},409),({'project_id':999999},404)]:
        body={'revision':doc['revision'],'project_id':pid,'project_revision':target['revision'],**patch}
        response=client.post(f'/api/quotations/{qid}/attach',json=body)
        assert response.status_code==status,response.text
        assert client.get(f'/api/quotations/{qid}').json()==doc
        assert client.get(f'/api/projects/{pid}/quotation').json()==target
        assert len(client.get('/api/quotations').json()['standalone'])==1
    assert client.request('DELETE',f'/api/quotations/{qid}',json={'revision':0}).status_code==409
    assert client.request('DELETE',f'/api/quotations/{qid}',json={'revision':doc['revision']}).status_code==204
    assert client.get(f'/api/quotations/{qid}').status_code==404


def test_desktop_upgrade_preserves_project_quote_and_creates_standalone_table(tmp_path):
    database=tmp_path/'legacy.db'
    old={'number':'LEGACY','customer':'Сохранённое КП','lines':[{'id':'row','name':'Светильник','quantity':'2','unit_price':'100'}]}
    with sqlite3.connect(database) as db:
        db.execute('CREATE TABLE projects (id INTEGER PRIMARY KEY,name VARCHAR NOT NULL,created_at DATETIME NOT NULL)')
        db.execute("INSERT INTO projects VALUES (1,'Старый проект','2026-11-10 10:00:00')")
        db.execute('CREATE TABLE quotations (project_id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,content JSON NOT NULL)')
        db.execute('INSERT INTO quotations VALUES (1,7,?)',(json.dumps(old),))
    script='''
from fastapi.testclient import TestClient
from app.main import app
with TestClient(app) as client:
    before=client.get('/api/projects/1/quotation').json()
    assert before['revision']==7 and before['number']=='LEGACY'
    result=client.post('/api/quotations',json={})
    assert result.status_code==201,result.text
    assert client.get('/api/projects/1/quotation').json()==before
    assert len(client.get('/api/projects').json())==1
'''
    result=subprocess.run([sys.executable,'-c',script],env={**os.environ,'DATABASE_URL':f'sqlite:///{database}',
        'AUTO_CREATE_SCHEMA':'1','STORAGE_DIR':str(tmp_path/'storage')},capture_output=True,text=True,timeout=30)
    assert result.returncode==0,result.stdout+result.stderr
    with sqlite3.connect(database) as db:
        assert db.execute('SELECT revision FROM quotations WHERE project_id=1').fetchone()[0]==7
        assert db.execute('SELECT count(*) FROM standalone_quotations').fetchone()[0]==1
