import logging
import os
from pathlib import Path


def configure_data_directory():
    root = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'SmartHomeCalc' / 'data'
    storage = root / 'storage'
    storage.mkdir(parents=True, exist_ok=True)
    os.environ['DATABASE_URL'] = f"sqlite:///{(root / 'smart-home-calc.db').as_posix()}"
    os.environ['STORAGE_DIR'] = str(storage)
    os.environ['AUTO_CREATE_SCHEMA'] = '1'
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

    uvicorn.run(app, host='127.0.0.1', port=5173, log_config=None)
