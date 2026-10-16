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
    for key in ('DATABASE_URL', 'STORAGE_DIR', 'AUTO_CREATE_SCHEMA'):
        monkeypatch.setenv(key, 'test-value')
    assert configure_data_directory() == new
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
