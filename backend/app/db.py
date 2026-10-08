import os
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

class Base(DeclarativeBase):
    pass

url = os.getenv('DATABASE_URL', 'postgresql+psycopg://smart_calc@/smart_home_calc_dev?host=/workspace/smart-home-calc-dev/socket&port=55432')
if url.startswith('postgresql://'):
    url = url.replace('postgresql://', 'postgresql+psycopg://', 1)
engine = create_engine(url, pool_pre_ping=True)
Session = sessionmaker(engine, expire_on_commit=False)

def session():
    with Session() as db:
        yield db
