from sqlalchemy import select
from .models import ElementType

LAYERS = ['Электроустановки', 'Освещение', 'LED-подсветка', 'Датчики', 'Электрокарнизы']

def seed(db):
    if db.scalar(select(ElementType.id).limit(1)):
        return
    groups = [
        ('Электроустановки', ['Розетка одинарная','Розетка двойная','USB','TV','RJ45','Выключатель','Диммер','Сценарная кнопка','Влагозащищенная розетка'], '#fb923c', 44),
        ('Освещение', ['Встроенный светильник','Накладной светильник','Люстра','Бра','Подвес','Линейное освещение','Spot','Linear','Wall washer','Pendant'], '#facc15', 44),
        ('Датчики', ['Движение','Присутствие','Температура','Влажность','CO2','Протечка'], '#a78bfa', None),
    ]
    for category, names, color, ip in groups:
        for name in names:
            defaults={'quantity':1,'ip':44 if name=='Влагозащищенная розетка' else 20}
            if name in ('Розетка одинарная','Розетка двойная','USB','TV','RJ45','Влагозащищенная розетка'):
                defaults['frame_posts']=1
            db.add(ElementType(name=name, category=category, color=color, wet_min_ip=ip, defaults=defaults))
    db.add(ElementType(name='Трек',category='Освещение',unit='м',color='#facc15',defaults={'length':1,'track_type':'магнитный','color':'черный','mount':'накладной','connectors':0,'end_caps':2}))
    db.add(ElementType(name='LED-линия',category='LED-подсветка',unit='м',color='#34d399',wet_min_ip=65,defaults={'length':1,'zone':'','strip_type':'','voltage':24,'ip':20,'profile':'','control':''}))
    db.add(ElementType(name='Электрокарниз',category='Электрокарнизы',color='#60a5fa',defaults={'quantity':1,'length':1,'control':'Zigbee'}))
    db.commit()
