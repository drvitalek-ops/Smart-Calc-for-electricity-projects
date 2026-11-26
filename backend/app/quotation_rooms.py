"""Switch linked quotation rows between a shared list and physical plan rooms."""
import json
import uuid
from collections import defaultdict
from decimal import Decimal,ROUND_HALF_UP
from fastapi import HTTPException
from sqlalchemy import select
from .models import Element

def calculated_rows(db,pid,layout):
    from .main import report_rows
    from .frame_goods import physical_key
    rows=[row for row in report_rows(db,pid)['rows'] if row['quantity']>0]
    rows=[{**row,'frame_quantities':{physical_key(row):row['quantity']},'frame_sources':{gid:physical_key(row) for gid in row.get('frame_ids',[])}} if row['category']=='Рамки' and not row.get('element_ids') else row for row in rows]
    if layout=='legacy':return rows
    frame_labels={}
    for row in rows:
        if row.get('frame_variant') and not row['product_id']:
            first=frame_labels.setdefault(row['frame_variant'],row)
            row['name']=first['name'];row['parameters']=first['parameters']
    grouped={}
    for original in rows:
        room=original['room'] if layout=='rooms' else ''
        parameters=json.loads(original['parameters']);parameters.pop('led_strip',None)
        row={**original,'room':room,'parameters':json.dumps(parameters,ensure_ascii=False,sort_keys=True)}
        identity={'room':room,'product_id':row['product_id'],'unit':row['unit'],'custom_name':row['name'] if row.get('custom_name') else ''} if row['product_id'] else {key:value for key,value in row.items() if key not in ('element_ids','quantity','total','frame_quantities','frame_sources','frame_ids','frame_product_explicit')}
        if row.get('frame_ids'):identity={'room':room,'frame_variant':row['frame_variant']}
        key=json.dumps(identity,ensure_ascii=False,sort_keys=True)
        if key not in grouped:grouped[key]={**row,'element_ids':[],'quantity':Decimal(0),**({'frame_quantities':{},'frame_sources':{},'frame_ids':[]} if 'frame_quantities' in row else {})}
        group=grouped[key];group['element_ids'].extend(row.get('element_ids',[]));group['quantity']+=Decimal(str(row['quantity']))
        if 'frame_quantities' in row:
            for key,value in row['frame_quantities'].items():group['frame_quantities'][key]=group['frame_quantities'].get(key,0)+value
            group['frame_sources'].update(row['frame_sources']);group['frame_ids'].extend(row['frame_ids'])
            group['frame_product_explicit']=group['frame_product_explicit'] or row['frame_product_explicit']
    result=[]
    for row in grouped.values():
        row['element_ids']=sorted(row['element_ids']);row['quantity']=float(row['quantity'].quantize(Decimal('.001'),rounding=ROUND_HALF_UP))
        row['total']=round(row['quantity']*row['unit_price'],2);result.append(row)
    return result


def represented_frames(lines,keys,sources=None):
    """Prefer physical frame IDs; old quotations retain their room-based keys."""
    sources=sources or {}
    result=set()
    for line in lines:
        if not line.source_key.startswith('frame:') or line.source_ids:continue
        if line.source_frame_ids:
            result.update(sources[gid] for gid in line.source_frame_ids if gid in sources and sources[gid] in keys)
        else:
            result.update(key for key in keys if key==line.source_key or 'frame::'+key.rsplit(':',1)[-1]==line.source_key)
    return result


def filter_frames(rows,excluded):
    result=[]
    for row in rows:
        if 'frame_quantities' in row:
            quantities={key:value for key,value in row['frame_quantities'].items() if key not in excluded}
            if not quantities:continue
            quantity=float(sum((Decimal(str(value)) for value in quantities.values()),Decimal(0)))
            sources={gid:key for gid,key in row.get('frame_sources',{}).items() if key in quantities}
            row={**row,'frame_quantities':quantities,'frame_sources':sources,'frame_ids':sorted(sources),'quantity':quantity,'total':round(quantity*row['unit_price'],2)}
        result.append(row)
    return result


def filter_frame_ids(rows,excluded):
    result=[]
    for row in rows:
        if row.get('frame_ids'):
            sources={gid:key for gid,key in row['frame_sources'].items() if gid not in excluded}
            if not sources:continue
            quantities={}
            for key in sources.values():quantities[key]=quantities.get(key,0)+1
            quantity=float(len(sources))
            row={**row,'frame_ids':sorted(sources),'frame_sources':sources,'frame_quantities':quantities,'quantity':quantity,'total':round(quantity*row['unit_price'],2)}
        result.append(row)
    return result


def _terms(line):
    fields=('type_id','product_id','name','sku','manufacturer','description','ip','comment','unit','unit_price','currency','discount','image')
    return json.dumps({**{key:getattr(line,key) for key in fields},'overrides':sorted(set(line.overrides)-{'room','unit_price'}),'manual':line.quantity_override is not None},ensure_ascii=False,sort_keys=True,default=lambda value:str(value.normalize()) if isinstance(value,Decimal) else str(value))


def regroup_quote(db,pid,quote,target):
    from .quotations import QuoteInput,source_key
    if target=='combined':
        from .quotation_prices import inherit_prices
        quote.room_layout=target;inherit_prices(quote)
    linked=[line for line in quote.lines if line.source_key]
    if not linked:raise HTTPException(422,'Сначала добавьте позиции с плана кнопкой «Обновить из расчёта»')
    rows=calculated_rows(db,pid,target)
    rows=filter_frames(rows,set(quote.excluded_frame_keys)) if quote.plan_frame_snapshot_ids is None else filter_frame_ids(rows,set(quote.excluded_frame_ids))
    owners={eid:line for line in linked for eid in line.source_ids}
    frame_owners={gid:line for line in linked for gid in line.source_frame_ids}
    frames=defaultdict(list)
    for line in linked:
        if line.source_key.startswith('frame:') and not line.source_ids:frames[line.source_key.rsplit(':',1)[-1]].append(line)
    elements={item.id:item for item in db.scalars(select(Element).where(Element.project_id==pid))}
    excluded=set(quote.excluded_plan_ids)
    rows=[{**row,'element_ids':[eid for eid in row.get('element_ids',[]) if eid not in excluded]} for row in rows if not row.get('element_ids') or any(eid not in excluded for eid in row['element_ids'])]
    candidates=[];hits=defaultdict(int)
    for row in rows:
        ids=row.get('element_ids',[])
        if ids:
            matches=list({owners[eid].id:owners[eid] for eid in ids if eid in owners and owners[eid].unit==row['unit'] and owners[eid].type_id in (None,row['type_id'])}.values())
        else:
            matches=list({frame_owners[gid].id:frame_owners[gid] for gid in row.get('frame_ids',[]) if gid in frame_owners}.values())
            if not matches:matches=[line for line in frames.get(row['name'],[]) if not row['room'] or line.source_key in (source_key(row),'frame::'+row['name'])]
        for line in matches:hits[line.id]+=1
        if matches:candidates.append((row,matches))
    if target=='rooms' and not candidates:
        raise HTTPException(422,'В КП нет связанных с планом позиций для распределения')
    for line in linked:
        if line.quantity_override is not None and hits[line.id]>1:
            raise HTTPException(409,'Позиция с ручным количеством распределяется по нескольким помещениям. Снимите галочку «Вручную» у позиции «'+line.name[:100]+'» и повторите действие.')
    output=[];used=set();ranks={line.id:index for index,line in enumerate(quote.lines)};order={}
    for row,matches in candidates:
        buckets={}
        for line in matches:buckets.setdefault(_terms(line),[]).append(line)
        if not row.get('element_ids') and len(buckets)>1:
            raise HTTPException(409,'У одинаковых рамок разные цены, скидки или ручные данные. Укажите одинаковые условия перед объединением помещений.')
        for lines in buckets.values():
            original=lines[0];part=original.model_copy(deep=True)
            if row.get('element_ids'):
                members={line.id for line in lines}
                part.source_ids=[eid for eid in row['element_ids'] if eid in owners and owners[eid].id in members]
                if len(buckets)==1:part.source_ids=list(row['element_ids'])
                key='length' if row['unit']=='м' else 'quantity'
                amount=sum((Decimal(str(elements[eid].parameters.get(key,0 if key=='length' else 1))) for eid in part.source_ids),Decimal(0)).quantize(Decimal('.001'),rounding=ROUND_HALF_UP)
                part.source_key=source_key({'element_ids':part.source_ids})
            else:
                part.source_frame_ids=list(row.get('frame_ids',[]));part.frame_variant=row.get('frame_variant','')
                amount=Decimal(str(row['quantity']));part.source_ids=[];part.source_key=source_key(row)
            if amount<=0:continue
            if part.id in used:part.id=uuid.uuid4().hex
            used.add(part.id);order[part.id]=min(ranks[line.id] for line in lines)
            part.room=row['room'];part.overrides=sorted(set(field for line in lines for field in line.overrides)-{'room'});part.source_signature=''
            part.calculated_quantity=amount
            part.quantity_override=sum((line.quantity_override for line in lines),Decimal(0)) if original.quantity_override is not None else None
            part.quantity=part.quantity_override if part.quantity_override is not None else amount
            output.append(part)
    for line in quote.lines:
        if not line.source_key:output.append(line);order[line.id]=ranks[line.id]
    if target=='rooms':output.sort(key=lambda line:(line.room in ('','Без помещения','Общие позиции'),line.room.casefold(),order[line.id]))
    else:output.sort(key=lambda line:order[line.id])
    quote.room_layout=target;quote.lines=output
    return QuoteInput.model_validate(quote.model_dump(mode='json'))
