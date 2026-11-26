import json
import shutil
import sqlite3

import pymupdf

from desktop import configure_data_directory, relocate_storage_paths


def test_copied_data_rebases_paths_without_changing_project_data(tmp_path, monkeypatch):
    old = tmp_path / 'old-user' / 'SmartHomeCalc' / 'data'
    storage = old / 'storage'
    storage.mkdir(parents=True)
    with pymupdf.open() as pdf:
        pdf.new_page()
        pdf.save(storage / 'project.pdf')
    (storage / 'project-0.png').write_bytes(b'preview')
    old_pdf = r'C:\Users\OldName\AppData\Local\SmartHomeCalc\data\storage\project.pdf'
    old_image = r'C:\Users\OldName\AppData\Local\SmartHomeCalc\data\storage\project-0.png'
    with sqlite3.connect(old / 'smart-home-calc.db') as db:
        db.execute('CREATE TABLE pages (id INTEGER PRIMARY KEY,pdf_path TEXT,image_path TEXT)')
        db.execute('INSERT INTO pages VALUES (1,?,?)', (old_pdf, old_image))
        db.execute('CREATE TABLE elements (parameters TEXT)')
        db.execute('INSERT INTO elements VALUES (?)', (json.dumps({'frame_group': 'keep-me', 'frame_posts': 3}),))
    local_app_data = tmp_path / 'Новый пользователь'
    new = local_app_data / 'SmartHomeCalc' / 'data'
    shutil.copytree(old, new)
    monkeypatch.setenv('LOCALAPPDATA', str(local_app_data))
    for key in ('DATABASE_URL', 'STORAGE_DIR', 'AUTO_CREATE_SCHEMA', 'SMART_HOME_CALC_DATA_DIR'):
        monkeypatch.setenv(key, 'test-value')
    assert configure_data_directory() == new
    import os
    assert os.environ['SMART_HOME_CALC_DATA_DIR']==str(new.resolve())
    with sqlite3.connect(new / 'smart-home-calc.db') as db:
        pdf_path, image_path = db.execute('SELECT pdf_path,image_path FROM pages').fetchone()
        assert pdf_path == str(new / 'storage' / 'project.pdf')
        assert image_path == str(new / 'storage' / 'project-0.png')
        assert json.loads(db.execute('SELECT parameters FROM elements').fetchone()[0]) == {'frame_group': 'keep-me', 'frame_posts': 3}
        with pymupdf.open(pdf_path) as pdf:
            assert len(pdf) == 1
    relocate_storage_paths(new)  # Repeat startup is safe.
    with sqlite3.connect(old / 'smart-home-calc.db') as db:
        assert db.execute('SELECT pdf_path FROM pages').fetchone()[0] == old_pdf


def test_transfer_does_not_invent_paths_for_missing_files(tmp_path):
    with sqlite3.connect(tmp_path / 'smart-home-calc.db') as db:
        db.execute('CREATE TABLE pages (id INTEGER PRIMARY KEY,pdf_path TEXT,image_path TEXT)')
        db.execute("INSERT INTO pages VALUES (1,'missing.pdf','missing.png')")
    relocate_storage_paths(tmp_path)
    with sqlite3.connect(tmp_path / 'smart-home-calc.db') as db:
        assert db.execute('SELECT pdf_path,image_path FROM pages').fetchone() == ('missing.pdf', 'missing.png')


def test_desktop_upgrades_old_nomenclature_columns_and_simplifies_contacts(tmp_path):
    import os
    import subprocess
    import sys
    database=tmp_path/'old.db'
    with sqlite3.connect(database) as db:
        db.execute('CREATE TABLE element_types (id INTEGER PRIMARY KEY,name VARCHAR(200) NOT NULL,category VARCHAR NOT NULL,unit VARCHAR NOT NULL,color VARCHAR NOT NULL,defaults JSON NOT NULL,wet_min_ip INTEGER)')
        db.execute('INSERT INTO element_types VALUES (1,?,?,?,?,?,NULL)',(
            'Звонковый выключатель одноклавишный (НЗ)','Электроустановки','шт','#15803d',json.dumps({'quantity':1,'contact_type':'НЗ'})))
    script='''
from fastapi.testclient import TestClient
from app.main import app
with TestClient(app) as client:
    kinds=client.get('/api/types').json()
    assert any(item['name']=='Звонковый выключатель одноклавишный' for item in kinds)
    assert not any('(НЗ)' in item['name'] for item in kinds)
    assert any(item['name']=='Розетка с USB (2 в 1)' for item in kinds)
'''
    result=subprocess.run([sys.executable,'-c',script],env={**os.environ,'DATABASE_URL':f'sqlite:///{database}','AUTO_CREATE_SCHEMA':'1','STORAGE_DIR':str(tmp_path/'storage')},capture_output=True,text=True,timeout=30)
    assert result.returncode==0,result.stderr
    with sqlite3.connect(database) as db:
        assert {'active','seed_key'} <= {item[1] for item in db.execute('PRAGMA table_info(element_types)')}
        assert db.execute('SELECT active FROM element_types WHERE id=1').fetchone()==(0,)


def test_desktop_upgrades_legacy_layers_and_keeps_manual_names_on_restart(tmp_path):
    import os
    import subprocess
    import sys
    database=tmp_path/'legacy-layers.db'
    with sqlite3.connect(database) as db:
        db.execute('CREATE TABLE projects (id INTEGER PRIMARY KEY,name VARCHAR(200) NOT NULL,created_at DATETIME NOT NULL)')
        db.execute("INSERT INTO projects VALUES (1,'Старый проект','2026-01-01 00:00:00')")
        db.execute('CREATE TABLE layers (id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL,name VARCHAR(200) NOT NULL,visible BOOLEAN NOT NULL,locked BOOLEAN NOT NULL,export BOOLEAN NOT NULL,opacity FLOAT NOT NULL)')
        db.execute("INSERT INTO layers VALUES (9,1,'LED-подсветка',0,0,1,.35)")
    script='''
from fastapi.testclient import TestClient
from app.main import app
with TestClient(app) as client:
    layers=client.get('/api/projects/1').json()['layers']
    original=next(layer for layer in layers if layer['id']==9)
    assert original['seed_key']=='LED-подсветка' and original['opacity']==.35 and not original['visible']
    assert client.patch('/api/layers/9',json={'name':'Мой LED'}).status_code==200
with TestClient(app) as client:
    layers=client.get('/api/projects/1').json()['layers']
    assert len(layers)==7
    assert next(layer for layer in layers if layer['id']==9)['name']=='Мой LED'
'''
    result=subprocess.run([sys.executable,'-c',script],env={**os.environ,'DATABASE_URL':f'sqlite:///{database}','AUTO_CREATE_SCHEMA':'1','STORAGE_DIR':str(tmp_path/'storage')},capture_output=True,text=True,timeout=30)
    assert result.returncode==0,result.stderr


def test_desktop_adds_project_preferences_without_losing_legacy_projects(tmp_path):
    import os
    import subprocess
    import sys
    database=tmp_path/'legacy-workspace.db'
    with sqlite3.connect(database) as db:
        db.execute('CREATE TABLE projects(id INTEGER PRIMARY KEY,name VARCHAR(200) NOT NULL,created_at DATETIME NOT NULL)')
        db.execute("INSERT INTO projects VALUES(1,'Существующий проект','2026-01-01 00:00:00')")
    script='''
from fastapi.testclient import TestClient
from app.main import app
for _ in range(2):
    with TestClient(app) as client:
        project=client.get('/api/projects/1').json()
        assert project['name']=='Существующий проект'
        assert project['last_worked_page_id'] is None
        response=client.patch('/api/projects/1/view-settings',json={'symbolScale':.7,'roomLabelsVisible':False})
        assert response.status_code==200,response.text
        assert client.get('/api/projects/1').json()['view_settings']=={'symbolScale':.7,'roomLabelsVisible':False}
'''
    result=subprocess.run([sys.executable,'-c',script],env={**os.environ,'DATABASE_URL':f'sqlite:///{database}','AUTO_CREATE_SCHEMA':'1','STORAGE_DIR':str(tmp_path/'storage')},capture_output=True,text=True,timeout=30)
    assert result.returncode==0,result.stderr
    with sqlite3.connect(database) as db:
        assert db.execute('SELECT name FROM projects').fetchone()==('Существующий проект',)
        assert {'last_worked_page_id','view_settings'} <= {row[1] for row in db.execute('PRAGMA table_info(projects)')}
