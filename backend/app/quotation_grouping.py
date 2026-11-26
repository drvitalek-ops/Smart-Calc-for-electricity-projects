"""Commercial grouping independent of per-object specification connections."""
from decimal import Decimal


def commercial_description(line):
    if line.source_ids and 'description' not in line.overrides:
        return '\n'.join(part for part in line.description.splitlines() if not part.startswith('Питает ленты: '))
    return line.description


def merge_key(line):
    # Plan quantities and manual additions must remain independently editable.
    origin=('elements',) if line.source_ids else ('frame',line.frame_variant) if line.source_frame_ids else ('frame',line.source_key) if line.source_key else ('manual',)
    generated=bool(line.source_ids and line.product_id and 'description' not in line.overrides)
    return (origin,line.room,line.product_id,line.type_id,line.name,line.sku,line.manufacturer,
        line.unit,line.currency,line.unit_price,line.discount,line.ip,line.comment,line.image,
        None if generated else commercial_description(line),generated,line.quantity_override is not None)


def merge_identical_lines(quote):
    from .quotations import money,source_key
    from .quotation_prices import inherit_prices
    inherit_prices(quote)
    groups={};replacements={};removed=set()
    for line in quote.lines:groups.setdefault(merge_key(line),[]).append(line)
    for members in groups.values():
        if len(members)<2:continue
        previous=members[0];quantity=sum((line.quantity for line in members),Decimal(0))
        calculated=sum((line.calculated_quantity or line.quantity for line in members),Decimal(0))
        if quantity>1000000 or previous.source_key and calculated>1000000:continue
        # One combined row must preserve both client and partner totals exactly.
        percent=previous.discount if previous.discount is not None else quote.global_discount
        bases=[money(item.quantity*item.unit_price) for item in members]
        base=money(quantity*previous.unit_price)
        if base!=sum(bases) or money(base*percent/100)!=sum(money(value*percent/100) for value in bases):
            continue
        merged=previous.model_copy(deep=True);merged.quantity=quantity
        merged.overrides=sorted({field for item in members for field in item.overrides})
        if merged.source_key:
            merged.calculated_quantity=calculated
            if merged.quantity_override is not None:merged.quantity_override=quantity
            merged.source_ids=sorted({eid for item in members for eid in item.source_ids})
            merged.source_frame_ids=sorted({gid for item in members for gid in item.source_frame_ids})
            if merged.source_frame_ids:merged.source_key=source_key({'frame_ids':merged.source_frame_ids,'name':previous.source_key.rsplit(':',1)[-1]})
            if merged.source_ids:merged.source_key=source_key({'element_ids':merged.source_ids});merged.source_signature=''
        if merged.source_ids and merged.product_id and 'description' not in merged.overrides:
            # Retain common product characteristics; connection-specific details
            # continue to live in the specification and original plan objects.
            common=set(commercial_description(previous).splitlines())
            for item in members[1:]:common.intersection_update(commercial_description(item).splitlines())
            merged.description='\n'.join(part for part in commercial_description(previous).splitlines() if part in common)
        else:merged.description=commercial_description(previous)
        replacements[previous.id]=merged
        for item in members[1:]:removed.add(item.id);quote._merged_line_ids[item.id]=merged.id
    for alias,target in quote._merged_line_ids.items():
        while target in quote._merged_line_ids:target=quote._merged_line_ids[target]
        quote._merged_line_ids[alias]=target
    quote.lines=[replacements.get(line.id,line) for line in quote.lines if line.id not in removed]
    return quote
