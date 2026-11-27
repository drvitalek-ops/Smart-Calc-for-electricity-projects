"""Apply explicit editor changes to existing linked objects in one undo step."""
import re
from decimal import Decimal,ROUND_FLOOR
from fastapi import HTTPException
from sqlalchemy import select
from .models import Element,Room,Quotation,Page,Layer,ElementType,Product,Project


def allocate(total,items,unit):
    scale=1000 if unit=='м' else 1
    ticks=Decimal(total)*scale
    if ticks!=ticks.to_integral_value():raise HTTPException(422,'Количество в штуках должно быть целым числом')
    ticks=int(ticks);minimum=1 if unit=='м' else 0
    if ticks<minimum*len(items):raise HTTPException(422,'Длина слишком мала для существующих линий. Минимум — 1 мм на линию.')
    key='length' if unit=='м' else 'quantity'
    weights=[max(Decimal(0),Decimal(str(item.parameters.get(key,1)))) for item in items]
    if not sum(weights):weights=[Decimal(1)]*len(items)
    weight_total=sum(weights)
    remaining=ticks-minimum*len(items);exact=[Decimal(remaining)*value/weight_total for value in weights]
    amounts=[int(value.to_integral_value(rounding=ROUND_FLOOR))+minimum for value in exact]
    order=sorted(range(len(items)),key=lambda i:(-(exact[i]-int(exact[i])),items[i].id))
    for i in order[:ticks-sum(amounts)]:amounts[i]+=1
    return [float(Decimal(value)/scale) if scale==1000 else value for value in amounts]


def apply_quote_changes(db,pid,quote,baseline=None,*,force_product_lines=()):
    from .main import ElementInput,require,validate_element,remember_elements
    from .catalog_types import product_type_id
    stored=db.get(Quotation,pid)
    if stored is None:return
    previous={eid:line for line in stored.content.get('lines',[]) for eid in line.get('source_ids',[])}
    persisted_ids=set(previous)
    derived={eid:line.model_dump(mode='json') for line in baseline.lines for eid in line.source_ids} if baseline else {}
    if baseline:
        for line in baseline.lines:
            for eid in line.source_ids:previous.setdefault(eid,line.model_dump(mode='json'))
    elements={item.id:item for item in db.scalars(select(Element).where(Element.project_id==pid))}
    product_ids={item.product_id for item in elements.values() if item.product_id is not None}|{line.product_id for line in quote.lines if line.product_id is not None}
    products=list(db.scalars(select(Product).where(Product.id.in_(product_ids))))
    type_ids={item.type_id for item in elements.values()}|{item.type_id for item in products}
    # Hold validation references: SQLAlchemy's weak identity map otherwise
    # reloads the same layer, page and type for every linked object.
    validation_context=[require(db,Project,pid),*db.scalars(select(Layer).where(Layer.project_id==pid)),*db.scalars(select(Page).where(Page.project_id==pid)),*db.scalars(select(ElementType).where(ElementType.id.in_(type_ids))),*products]
    rooms=list(db.scalars(select(Room).where(Room.project_id==pid)));pending=[]
    commercial=('sku','manufacturer','unit_price','currency','description')
    for line in quote.lines:
        if not line.source_ids:continue
        items=[elements.get(eid) for eid in line.source_ids]
        if any(item is None for item in items):raise HTTPException(409,'Объекты плана изменились. Откройте КП заново перед сохранением.')
        old=list({previous[eid]['id']:previous[eid] for eid in line.source_ids if eid in previous}.values())
        if not old:continue
        differences={}
        def changed(field):
            if field in differences:return differences[field]
            value=getattr(line,field)
            result=any(Decimal(str(row.get(field,0)))!=value for row in old) if field=='unit_price' else any(row.get(field,'')!=value for row in old)
            if result and field in ('name','ip',*commercial) and field not in line.overrides:
                current=[derived[eid] for eid in line.source_ids if eid in derived]
                if current:
                    result=any(Decimal(str(row.get(field,0)))!=value for row in current) if field=='unit_price' else any(row.get(field,'')!=value for row in current)
            if field=='product_id' and line.id in force_product_lines:
                result=any(item.product_id!=value for item in items)
            differences[field]=result
            return result
        quantity=line.quantity_override is not None and any(Decimal(str(row.get('quantity_override') or 0))!=line.quantity_override for row in old)
        if not quantity and line.quantity_override is None and line.calculated_quantity is not None:
            quantity=line.quantity!=line.calculated_quantity and any(Decimal(str(row['quantity']))!=line.quantity for row in old)
        if quantity:
            key='length' if line.unit=='м' else 'quantity'
            actual=sum((Decimal(str(item.parameters.get(key,0 if key=='length' else 1))) for item in items),Decimal(0))
            if actual==line.quantity:line.quantity_override=None;line.calculated_quantity=actual;quantity=False
        amounts=allocate(line.quantity,items,line.unit) if quantity else None
        fields={key:getattr(line,key) for key in commercial if changed(key)}
        for index,item in enumerate(items):
            parameters={**item.parameters};values={key:getattr(item,key) for key in ElementInput.model_fields}
            item_fields={**fields,'unit_price':line.unit_price,'currency':line.currency} if item.id not in persisted_ids else fields
            if item_fields:parameters['_quotation']={**parameters.get('_quotation',{}),**{key:str(value) for key,value in item_fields.items()}}
            if changed('name'):parameters['display_name']=line.name[:200]
            if changed('ip'):
                if line.ip.strip():
                    match=re.fullmatch(r'(?:IP\s*)?(\d{1,2})',line.ip.strip(),re.I)
                    if not match or int(match[1])>69:raise HTTPException(422,'Укажите IP числом от 0 до 69, например IP44')
                    parameters['ip']=int(match[1])
                else:parameters.pop('ip',None)
            if changed('comment'):values['comment']=line.comment
            if changed('room') and line.room.strip():
                room=next((room for room in rooms if room.name==line.room and room.page_id in (None,item.page_id)),None)
                if room:values['room_id']=room.id
            if changed('product_id'):
                product=require(db,Product,line.product_id) if line.product_id else None
                if product and (product.unit!=line.unit or product_type_id(db,product) not in (None,item.type_id)):raise HTTPException(422,'Товар не соответствует объектам плана')
                values['product_id']=line.product_id
            if amounts is not None:
                key='length' if line.unit=='м' else 'quantity';parameters[key]=amounts[index]
                if line.unit=='м':parameters['manual_length']=amounts[index]
            values['parameters']=parameters
            if all(values[key]==getattr(item,key) for key in values):continue
            if require(db,Layer,item.layer_id).locked:raise HTTPException(409,'Слой связанных объектов заблокирован. Разблокируйте его перед изменением в КП.')
            values['parameters']=validate_element(db,pid,ElementInput(**values),existing_type_id=item.type_id,existing_product_id=item.product_id)
            pending.append((item,values))
        if quantity:line.quantity_override=None;line.calculated_quantity=line.quantity
    # Frame goods belong to physical frames, separately from socket mechanisms.
    previous_frames={gid:line for line in (baseline.lines if baseline else []) for gid in line.source_frame_ids}
    by_id={item.id:(item,values) for item,values in pending}
    from .frame_goods import pending_properties
    for line in quote.lines:
        if not line.source_frame_ids:continue
        old={previous_frames[gid].product_id for gid in line.source_frame_ids if gid in previous_frames}
        if not old or old=={line.product_id} and line.id not in force_product_lines:continue
        for item,parameters in pending_properties(db,pid,line.source_frame_ids,{'frame_product_id':line.product_id}):
            values=by_id.get(item.id,(item,{key:getattr(item,key) for key in ElementInput.model_fields}))[1]
            values['parameters']={**values['parameters'],'frame_product_id':parameters['frame_product_id']}
            by_id[item.id]=(item,values)
    pending=list(by_id.values())
    if pending:
        remember_elements(db,pid)
        for item,values in pending:
            for key,value in values.items():setattr(item,key,value)
        db.flush()
