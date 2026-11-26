"""Properties belong to a physical frame, separately from its devices."""
import json
import re
from pathlib import Path
from collections import defaultdict
from fastapi import HTTPException
from sqlalchemy import select
from .models import Element,ElementType,Layer,Product

FRAME_KEYS={'frame_group','frame_posts','frame_product_id','frame_color','frame_plan_color'}


PALETTE=json.loads((Path(__file__).parent/'assets'/'frame-colors.json').read_text(encoding='utf-8'))


def plan_color(parameters,product_color=''):
    explicit=parameters.get('frame_plan_color','')
    if isinstance(explicit,str) and re.fullmatch('#[0-9a-fA-F]{6}',explicit):return explicit.lower()
    value=normalized_color(str(parameters.get('frame_color') or product_color or '')).lower().replace('ё','е')
    if re.fullmatch('#[0-9a-f]{6}',value):return value
    return next((color for name,color in PALETTE['colors'].items() if value==name or value.startswith(name+' ')),PALETTE['default'])


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


def draw_frames(sheet,page,rows,db):
    """Render the same frame finish/outline as the interactive plan."""
    groups=defaultdict(list)
    for element,kind,_ in rows:
        if kind.category=='Электроустановки' and element.parameters.get('frame_group'):groups[element.parameters['frame_group']].append(element)
    product_ids={item.parameters['frame_product_id'] for members in groups.values() for item in members if item.parameters.get('frame_product_id') is not None}
    products={item.id:item for item in db.scalars(select(Product).where(Product.id.in_(product_ids)))} if product_ids else {}
    import pymupdf
    unit=page.width/1000
    for members in groups.values():
        if len(members)!=int(members[0].parameters.get('frame_posts',0)) or len({item.room_id for item in members})!=1:continue
        parameters=members[0].parameters;product=products.get(parameters.get('frame_product_id'))
        color=plan_color(parameters,product.parameters.get('color','') if product else '')
        rgb=tuple(int(color[index:index+2],16)/255 for index in (1,3,5))
        rect=pymupdf.Rect(min(item.x for item in members)*page.width-20*unit,min(item.y for item in members)*page.height-20*unit,max(item.x for item in members)*page.width+20*unit,max(item.y for item in members)*page.height+20*unit)
        rect=rect & sheet.rect
        if .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]>.745:sheet.draw_rect(rect,color=(.39,.45,.55),width=4)
        sheet.draw_rect(rect,color=rgb,fill=rgb,fill_opacity=.06,width=1.5)
