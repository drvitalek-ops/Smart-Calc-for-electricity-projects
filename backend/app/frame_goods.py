"""Properties belong to a physical frame, separately from its devices."""
import json
from collections import defaultdict
from fastapi import HTTPException
from sqlalchemy import select
from .models import Element,ElementType,Layer,Product

FRAME_KEYS={'frame_group','frame_posts','frame_product_id','frame_color'}


def normalized_color(value):
    return ' '.join(value.split())


def variant(posts,color,product_id):
    return 'product:'+str(product_id) if product_id is not None else 'color:'+str(posts)+':'+normalized_color(color).casefold().replace('ё','е')


def base_name(posts):
    return f'Рамка на {posts} '+('пост' if posts==1 else 'поста' if posts<5 else 'постов')


def physical_key(row):
    parameters=json.loads(row['parameters']);posts=int(parameters['frame_posts'])
    if row.get('product_id') is not None:return 'frame:'+row['room']+':product='+str(row['product_id'])
    color=normalized_color(str(parameters.get('frame_color',''))).casefold().replace('ё','е')
    return 'frame:'+row['room']+':'+base_name(posts)+((' · '+color) if color else '')


def validate_product(db,product_id,posts,allow_inactive=False):
    if product_id is None:return None
    from .catalog_types import product_type_id
    product=db.get(Product,product_id)
    if product is None:raise HTTPException(404,'Товар рамки не найден')
    kind=db.get(ElementType,product.type_id)
    if product.unit!='шт' or product_type_id(db,product) is not None and kind.category!='Рамки':
        raise HTTPException(422,'Для рамки выберите товар категории «Рамки» или без номенклатуры с единицей «шт»')
    if not product.active and not allow_inactive:raise HTTPException(409,'Товар рамки в архиве. Сначала восстановите его в каталоге.')
    required=product.parameters.get('frame_posts',kind.defaults.get('frame_posts'))
    if required not in (None,''):
        try:matches=int(required)==posts and float(required)==int(required)
        except (TypeError,ValueError):matches=False
        if not matches:raise HTTPException(422,'Количество постов выбранного товара не совпадает с рамкой')
    return product


def apply_properties(db,pid,groups,changes):
    from .main import require,remember_elements,Project
    require(db,Project,pid);groups=set(groups)
    if not groups:raise HTTPException(422,'Выберите рамку на плане')
    rows=list(db.execute(select(Element,ElementType,Layer).join(ElementType,Element.type_id==ElementType.id).join(Layer,Element.layer_id==Layer.id).where(Element.project_id==pid,Element.parameters['frame_group'].as_string().in_(groups))))
    by_group=defaultdict(list)
    for row in rows:by_group[row[0].parameters.get('frame_group')].append(row)
    pending=[]
    for group in groups:
        members=by_group[group]
        if not members:raise HTTPException(404,'Рамка не найдена. Обновите план.')
        posts={int(item.parameters.get('frame_posts',0)) for item,_,_ in members}
        if len(posts)!=1 or next(iter(posts))!=len(members) or not 1<=len(members)<=6 or len({item.room_id for item,_,_ in members})!=1 or any(kind.category!='Электроустановки' for _,kind,_ in members):
            raise HTTPException(409,'Рамка неполная. Сначала назначьте её электроустановкам заново.')
        if any(layer.locked for _,_,layer in members):raise HTTPException(409,'Слой рамки заблокирован')
        if 'frame_product_id' in changes:
            product_id=changes['frame_product_id'];validate_product(db,product_id,len(members),all(item.parameters.get('frame_product_id')==product_id for item,_,_ in members))
        for item,_,_ in members:
            parameters={**item.parameters,**changes}
            if parameters!=item.parameters:pending.append((item,parameters))
    if pending:
        # A partial change cannot safely divide an explicitly manual CP count.
        from .models import Quotation
        from .quotations import get_quote
        stored=db.get(Quotation,pid)
        for line in get_quote(db,pid).lines if stored else []:
            ids=set(line.source_frame_ids)
            if ids&groups and ids-groups and line.quantity_override is not None:
                raise HTTPException(409,'В КП у рамок задано ручное количество. Снимите галочку «Вручную» перед изменением части рамок.')
        remember_elements(db,pid)
        for item,parameters in pending:item.parameters=parameters
        db.flush()
    return {'frame_groups':sorted(groups),'changed':len(pending)}
