"""SQLite placement must not reuse IDs still referenced by CP or plan history."""
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.db import Base
from app.models import Project,Page,Layer,ElementType,Element


def test_sqlite_replacement_keeps_a_new_identity_across_restart(tmp_path):
    from app.models import initialize_element_sequence
    engine=create_engine('sqlite:///'+str(tmp_path/'identities.sqlite'))
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        project=Project(name='Тест');kind=ElementType(name='Блок питания',category='LED-подсветка',unit='шт',color='#dc2626',defaults={});db.add_all([project,kind]);db.flush()
        page=Page(project_id=project.id,number=1,width=1000,height=700,source_index=0,pdf_path='plan.pdf',image_path='plan.png');layer=Layer(project_id=project.id,name='LED-подсветка');db.add_all([page,layer]);db.flush()
        values=dict(project_id=project.id,page_id=page.id,layer_id=layer.id,type_id=kind.id,x=.2,y=.3,parameters={},geometry={},comment='')
        old=Element(id=100,**values);db.add(old);db.commit()
    # Upgrade an existing DB before its highest object can be deleted.
    with engine.begin() as connection:initialize_element_sequence(connection)
    with Session(engine) as db:
        db.delete(db.get(Element,100));db.commit();new=Element(**values);db.add(new);db.commit();assert new.id==101
    engine.dispose();engine=create_engine('sqlite:///'+str(tmp_path/'identities.sqlite'))
    with Session(engine) as db:
        db.delete(db.get(Element,101));db.commit();new=Element(**values);db.add(new);db.commit();assert new.id==102
    engine.dispose()
