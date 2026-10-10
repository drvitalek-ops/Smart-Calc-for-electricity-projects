import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

class Base(DeclarativeBase):
    pass

url = os.getenv('DATABASE_URL', 'postgresql+psycopg://smart_calc@/smart_home_calc_dev?host=/workspace/smart-home-calc-dev/socket&port=55432')
if url.startswith('postgresql://'):
    url = url.replace('postgresql://', 'postgresql+psycopg://', 1)
connect_args = {'check_same_thread': False} if url.startswith('sqlite:') else {}
engine = create_engine(url, pool_pre_ping=True, connect_args=connect_args)

if url.startswith('sqlite:'):
    @event.listens_for(engine, 'connect')
    def enable_sqlite_foreign_keys(connection, _record):
        cursor = connection.cursor()
        cursor.execute('PRAGMA foreign_keys=ON')
        cursor.close()

Session = sessionmaker(engine, expire_on_commit=False)

def session():
    with Session() as db:
        yield db
