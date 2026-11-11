import logging
import os
import sqlite3
from contextlib import closing
from pathlib import Path, PureWindowsPath


def relocate_storage_paths(root):
    """Rebase managed PDF/PNG paths after moving desktop data to a new user/PC."""
    database = root / 'smart-home-calc.db'
    if not database.is_file():
        return
    with closing(sqlite3.connect(database)) as connection, connection:
        if not connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='pages'").fetchone():
            return
        for page_id, pdf_path, image_path in connection.execute('SELECT id,pdf_path,image_path FROM pages').fetchall():
            for column, old_path in (('pdf_path', pdf_path), ('image_path', image_path)):
                # Windows paths must also be understood by migration tests on Linux.
                name = PureWindowsPath(old_path).name
                new_path = root / 'storage' / name
                if new_path.is_file() and str(new_path) != old_path:
                    connection.execute(f'UPDATE pages SET {column}=? WHERE id=?', (str(new_path), page_id))


def configure_data_directory():
    root = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'SmartHomeCalc' / 'data'
    storage = root / 'storage'
    storage.mkdir(parents=True, exist_ok=True)
    os.environ['DATABASE_URL'] = f"sqlite:///{(root / 'smart-home-calc.db').as_posix()}"
    os.environ['STORAGE_DIR'] = str(storage)
    os.environ['AUTO_CREATE_SCHEMA'] = '1'
    os.environ['SMART_HOME_CALC_DATA_DIR'] = str(root.resolve())
    version=os.environ.get('SMART_HOME_CALC_APP_VERSION','')
    if version:
        from app.desktop_backup import preserve_before_upgrade
        try:
            if preserve_before_upgrade(root,version):(root/'rollback-warning.txt').unlink(missing_ok=True)
        except Exception as exc:
            logging.exception('Could not create the pre-upgrade data snapshot')
            try:(root/'rollback-warning.txt').write_text(str(exc),encoding='utf-8')
            except OSError:pass
    relocate_storage_paths(root)
    return root


if __name__ == '__main__':
    data_directory = configure_data_directory()
    logging.basicConfig(
        filename=data_directory / 'server.log',
        level=logging.INFO,
        format='%(asctime)s %(levelname)s %(name)s %(message)s',
    )
    import uvicorn
    from app.main import app

    port = int(os.environ.get('SMART_HOME_CALC_PORT', '5173'))
    if not 1024 <= port <= 65535:
        raise ValueError('SMART_HOME_CALC_PORT must be between 1024 and 65535')
    uvicorn.run(app, host='127.0.0.1', port=port, log_config=None)
