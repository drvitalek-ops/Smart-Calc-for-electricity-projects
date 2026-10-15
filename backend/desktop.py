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

    port = int(os.environ.get('SMART_HOME_CALC_PORT', '5173'))
    if not 1024 <= port <= 65535:
        raise ValueError('SMART_HOME_CALC_PORT must be between 1024 and 65535')
    uvicorn.run(app, host='127.0.0.1', port=port, log_config=None)
