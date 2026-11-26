"""Keep physical frame provenance separate from the devices inside a frame."""
import hashlib
import json
from decimal import Decimal
from .frame_goods import base_name


def attach_legacy(lines,rows,excluded=()):
    """Upgrade old room/name links in memory; reading does not rewrite saved CPs."""
    from .quotation_rooms import filter_frames
    rows=filter_frames(rows,set(excluded))
    claimed={gid for line in lines for gid in line.source_frame_ids}
    for line in lines:
        if line.source_ids or line.source_frame_ids or not line.source_key.startswith('frame:'):continue
        for row in rows:
            if not row.get('frame_ids'):continue
            name=base_name(int(json.loads(row['parameters'])['frame_posts']))
            for gid,physical in row.get('frame_sources',{}).items():
                room=physical.rsplit(':product=',1)[0][6:] if ':product=' in physical else physical.split(':'+name,1)[0][6:]
                if gid not in claimed and line.source_key in ('frame:'+room+':'+name,'frame::'+name):
                    line.source_frame_ids.append(gid);claimed.add(gid)
        if line.source_frame_ids:
            variants={row['frame_variant'] for row in rows if set(row.get('frame_ids',[]))&set(line.source_frame_ids)}
            if len(variants)==1:line.frame_variant=next(iter(variants))


def sync_frames(db,pid,quote,rows):
    from .quotations import _new_plan_line,source_key,source_signature,product_snapshot
    from .quotation_rooms import _terms
    from .models import Product
    frame_lines=[line for line in quote.lines if line.source_key.startswith('frame:') and not line.source_ids]
    owners={gid:line for line in frame_lines for gid in line.source_frame_ids}
    templates={}
    for line in frame_lines:
        if line.quantity_override is None:templates.setdefault(line.frame_variant,{}).setdefault(_terms(line),line)
    used={line.id for line in quote.lines if not (line.source_key.startswith('frame:') and not line.source_ids)};output=[]
    for row in rows:
        if not row.get('frame_ids'):continue
        partitions={}
        for gid in row['frame_ids']:
            owner=owners.get(gid)
            partitions.setdefault(owner.id if owner else None,[]).append(gid)
        for owner_id,ids in partitions.items():
            old=owners[ids[0]] if owner_id else None
            if old is None:
                candidates=templates.get(row['frame_variant'],{})
                if len(candidates)==1:old=next(iter(candidates.values()))
            fresh=_new_plan_line(db,pid,{**row,'frame_ids':ids},[],Decimal(len(ids)),set())
            line=old.model_copy(deep=True) if old else fresh
            same_variant=old is not None and old.frame_variant==row['frame_variant']
            if old and not same_variant:
                same_product=old.product_id==row['product_id']
                if row['product_id'] is not None:
                    product_snapshot(db,line,db.get(Product,row['product_id']))
                    if same_product:line.unit_price=old.unit_price;line.currency=old.currency
                    line.overrides=[field for field in line.overrides if field in ('room','unit_price','currency') and same_product]
                elif row.get('frame_product_explicit') or old.frame_variant.startswith('product:') or not old.product_id:
                    for field in ('product_id','type_id','name','sku','manufacturer','description','image','ip'):
                        setattr(line,field,getattr(fresh,field))
                    line.overrides=[field for field in line.overrides if field in ('room','unit_price','currency')]
            if line.product_id==row['product_id']:
                if 'name' not in line.overrides:line.name=fresh.name
                if 'description' not in line.overrides:line.description=fresh.description
            # New frames inherit agreed terms only for the same product/color variant.
            line.source_ids=[];line.source_frame_ids=sorted(ids);line.frame_variant=row['frame_variant']
            if not old or not same_variant or set(ids)!=set(old.source_frame_ids):line.source_key=source_key({**row,'frame_ids':ids})
            line.source_signature=source_signature(row)
            if 'room' not in line.overrides:line.room=row['room']
            amount=Decimal(len(ids))
            if line.calculated_quantity!=amount:line.calculated_quantity=amount
            effective=line.quantity_override if line.quantity_override is not None else amount
            if line.quantity!=effective:line.quantity=effective
            if line.id in used:line.id='frame-'+hashlib.sha256((line.id+':'+','.join(sorted(ids))).encode()).hexdigest()
            used.add(line.id);output.append(line)
    return output
