"""Geometric PDF tables, with explicit arithmetic checks instead of guessed prices.

All coordinates stay in PDF points. Text drawing order, font size and whether a
producer draws table borders must not determine the imported financial values.
"""
import base64
import re
from dataclasses import dataclass
from decimal import Decimal
import pymupdf
from .quotation_import import normalized, numeric
from .quotations import money


@dataclass
class Cell:
    x0: float
    y0: float
    x1: float
    y1: float
    text: str
    data_cx: float | None = None

    @property
    def cy(self): return (self.y0+self.y1)/2

    @property
    def cx(self): return (self.x0+self.x1)/2


def joined(words):
    return Cell(min(w.x0 for w in words),min(w.y0 for w in words),
                max(w.x1 for w in words),max(w.y1 for w in words),' '.join(w.text for w in words))


def visual_lines(words):
    """Cluster by baseline, including separately drawn currency symbols."""
    lines=[]
    for word in sorted(words,key=lambda w:(w.cy,w.x0)):
        match=next((line for line in reversed(lines[-4:])
                    if abs(line[0].cy-word.cy)<=min(4,max(2,(word.y1-word.y0)*.32))),None)
        if match is None: lines.append([word])
        else: match.append(word)
    return [sorted(line,key=lambda w:w.x0) for line in lines]


def header_kind(text):
    name=normalized(text)
    if name in ('n','no','num','номер','пп','nпп','номерпп') or text.strip() in ('№','#'): return 'number'
    if any(k in name for k in ('наименован','название','номенклат','описание','description','productname','itemname')) or name in ('товар','товары','товарартикул','name','product'): return 'name'
    if any(k in name for k in ('колво','колич','quantity','qty')) or name in ('кол','count'): return 'quantity'
    if any(k in name for k in ('артикул','sku','article')) or name=='код': return 'sku'
    if name in ('ед','едизм','единица','единицы','unit','uom','единицаизмерения','едизмерения'): return 'unit'
    if any(k in name for k in ('цена','price','заединиц','заед')) or name in ('ррц','рц','розничная'): return 'price'
    if any(k in name for k in ('скидк','discount')): return 'discount'
    if any(k in name for k in ('сумма','стоимость','amount','linetotal')) or name=='total': return 'total'
    return None


def headers(words):
    fragments=[]
    for line in visual_lines(words):
        run=[]
        for word in line:
            if run and word.x0-run[-1].x1>max(11,(word.y1-word.y0)*1.05):
                fragments.append(joined(run));run=[]
            run.append(word)
        if run: fragments.append(joined(run))
    # Reconstruct multi-line headings such as «КОЛ- / ВО», «Цена / с НДС».
    candidates=[]
    for fragment in fragments:
        pieces=[fragment]
        for other in fragments:
            if other is fragment: continue
            if normalized(other.text) in ('во','изм','измерения','ндс','сндс','безндс','руб','безскидки','соскидкой','единицу') and 0<other.cy-fragment.cy<max(23,(fragment.y1-fragment.y0)*2.2) and min(fragment.x1,other.x1)>max(fragment.x0,other.x0):
                pieces.append(other)
        combined=joined(pieces)
        kind=header_kind(combined.text) or header_kind(fragment.text)
        if kind: candidates.append((kind,combined if header_kind(combined.text)==kind else fragment))
    result=[]
    for kind,name in candidates:
        if kind!='name': continue
        band=[(k,c) for k,c in candidates if abs(c.cy-name.cy)<22]
        mapping={}
        for key,cell in sorted(band,key=lambda item:item[1].y0):
            if key not in mapping or cell.y1>mapping[key].y1: mapping[key]=cell
        if 'quantity' not in mapping or not ('price' in mapping or 'total' in mapping): continue
        # Prefer an explicit original price over a second, discounted-price column.
        prices=[c for k,c in band if k=='price']
        if prices:
            mapping['price']=min(prices,key=lambda c:(bool(re.search(r'соскид|послескид|discounted|netprice',normalized(c.text))),c.x0))
        if not any(abs(existing['name'].cy-name.cy)<24 for existing in result): result.append(mapping)
    return sorted(result,key=lambda m:m['name'].cy)


def strict_number(text):
    """Never turn a model code, VAT note or two separate numbers into money."""
    value=re.sub(r'(?:RUB|RUR|USD|EUR|руб\.?|р\.|шт\.?|пог\.?\s*м\.?|pcs\.?|метр(?:а|ов)?|м\.?|m|₽|€|\$|%)', '', text, flags=re.I).strip()
    value=value.replace('\u00a0',' ').replace('\u202f',' ').replace('−','-')
    if not re.fullmatch(r'[+-]?(?:\d{1,3}(?:[ \u2009\']\d{3})+|\d+)(?:[.,]\d{1,3})?|[+-]?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?',value): return None
    return numeric(value)


def currency(text,default='RUB'):
    if '$' in text or re.search(r'\bUSD\b',text,re.I): return 'USD'
    if '€' in text or re.search(r'\bEUR\b',text,re.I): return 'EUR'
    return default


def rules(page,top=0,bottom=None):
    horizontal=[];vertical=[]
    for drawing in page.get_drawings():
        for item in drawing['items']:
            if item[0]=='l':
                a,b=item[1:3]
                if abs(a.y-b.y)<1 and abs(a.x-b.x)>page.cropbox.width*.45: horizontal.append(a.y)
                if abs(a.x-b.x)<1 and abs(a.y-b.y)>18 and min(a.y,b.y)<(bottom or page.cropbox.height) and max(a.y,b.y)>top: vertical.append(a.x)
            elif item[0]=='re':
                r=item[1]
                if r.height<2 and r.width>page.cropbox.width*.45: horizontal.append(r.y0)
                if r.width<2 and r.height>18 and r.y0<(bottom or page.cropbox.height) and r.y1>top: vertical.append(r.x0)
    return sorted(set(horizontal)),sorted(set(vertical))


def bounds(mapping,key,width,vertical):
    cell=mapping[key]
    ordered=sorted(mapping.items(),key=lambda item:item[1].cx)
    index=next(i for i,item in enumerate(ordered) if item[0]==key)
    prev=ordered[index-1] if index else None
    nxt=ordered[index+1] if index+1<len(ordered) else None
    left=(prev[1].x1+cell.x0)/2 if prev else 0
    right=(cell.x1+nxt[1].x0)/2 if nxt else width
    if prev and prev[0] in ('name','sku') and key in ('price','quantity','total'):
        left=max(left,cell.x1-max(85,width*.17))
    candidates=[x for x in vertical if left-30<x<cell.x0+2]
    if candidates: left=max(candidates)
    candidates=[x for x in vertical if cell.x1-2<x<right+30]
    if candidates: right=min(candidates)
    return left,right


def financial_values(words,mapping,width,vertical):
    from functools import lru_cache
    numeric_keys=sorted((k for k in mapping if k in ('number','price','quantity','total','discount')),key=lambda k:mapping[k].cx)
    runs=[];run=[]
    for word in sorted(words,key=lambda w:w.x0):
        acceptable=word.text in ('?','—','–','-') or strict_number(word.text) is not None or re.fullmatch(r'[₽€$%]|RUB|USD|EUR|руб\.?',word.text,re.I)
        if run and (not acceptable or word.x0-run[-1].x1>max(10,(word.y1-word.y0)*.9)):
            runs.append(joined(run));run=[]
        if acceptable: run.append(word)
    if run: runs.append(joined(run))
    runs=[r for r in runs if strict_number(r.text) is not None or r.text in ('?','—','–','-')]
    # Ordered matching permits missing cells without shifting every subsequent
    # column. Both left- and right-aligned headings occur in supplier documents.
    @lru_cache(None)
    def assign(ki,ri):
        if ki==len(numeric_keys): return 0,()
        if ri==len(runs): return 1.8*(len(numeric_keys)-ki),()
        key=numeric_keys[ki];header=mapping[key];value=runs[ri]
        skip_cost,skip_pairs=assign(ki+1,ri)
        best=(skip_cost+1.8,skip_pairs)
        ignored=assign(ki,ri+1)
        if ignored[0]<best[0]: best=ignored
        scale=max(40,min(90,width*.14))
        distance=abs(value.cx-(header.data_cx if header.data_cx is not None else header.cx))/scale
        allowed=distance<1.4
        if vertical:
            left,right=bounds(mapping,key,width,vertical)
            allowed=allowed and left<=value.cx<right
        if allowed:
            rest,pairs=assign(ki+1,ri+1)
            candidate=(rest+distance*distance,((key,value),)+pairs)
            if candidate[0]<best[0]: best=candidate
        return best
    result={}
    for key,run in assign(0,0)[1]:
        value=strict_number(run.text)
        compact=re.sub(r'[^0-9,.-]','',run.text)
        if key in ('price','total') and re.fullmatch(r'[+-]?\d{1,3}(?:[,.]\d{3})+',compact):
            value=Decimal(compact.replace(',','').replace('.',''))
        result[key]=(value,run.text,run)
    return result


def financial_cell(words,mapping,key,width,vertical):
    value=financial_values(words,mapping,width,vertical).get(key)
    return value[:2] if value else (None,'')


def name_text(words):
    lines=visual_lines(words)
    return ' '.join(' '.join(w.text for w in line) for line in lines).strip()


def extract_page(page,words,mapping,top,bottom,warnings):
    horizontal,vertical=rules(page,top,bottom)
    width=page.cropbox.width
    selected=[w for w in words if top<w.cy<bottom]
    footer_lines=[line for line in visual_lines(selected) if re.match(r'^(итого|всего|к\s*оплате|total|subtotal|ндс|vat)\b',name_text(line),re.I)]
    if footer_lines:
        bottom=min(bottom,min(w.y0 for w in footer_lines[0]));selected=[w for w in selected if w.cy<bottom]
    lines=visual_lines(selected)
    # Learn actual alignment from arithmetically consistent rows. Supplier
    # headings and their values often use different horizontal alignment.
    from statistics import median
    positions={key:[] for key in mapping}
    for line in lines:
        values=financial_values(line,mapping,width,vertical)
        if not all(k in values and values[k][0] is not None for k in ('price','quantity','total')): continue
        if abs(money(values['price'][0]*values['quantity'][0])-values['total'][0])>Decimal('.005'): continue
        for key,(_,_,cell) in values.items(): positions[key].append(cell.cx)
    for key,samples in positions.items():
        if samples: mapping[key].data_cx=median(samples)
    candidates=[]
    for line in visual_lines(selected):
        if re.search(r'^(итого|всего|к\s*оплате|total|subtotal|ндс|vat)\b',name_text(line),re.I) or re.fullmatch(r'\d+\s*/\s*\d+',name_text(line)): continue
        qty,qty_text=financial_cell(line,mapping,'quantity',width,vertical)
        price,price_text=financial_cell(line,mapping,'price',width,vertical)
        total,total_text=financial_cell(line,mapping,'total',width,vertical)
        if qty is not None or price is not None:
            cy=sum(w.cy for w in line)/len(line)
            candidates.append({'cy':cy,'quantity':qty,'price':price,'total':total,'price_text':price_text,'quantity_text':qty_text,'total_text':total_text,'words':line})
    # Vertically offset text within the same table row (including currency signs).
    anchors=[]
    for item in candidates:
        if anchors and item['cy']-anchors[-1]['cy']<7:
            previous=anchors[-1]
            for key in ('quantity','price','total'):
                if previous[key] is None and item[key] is not None:
                    previous[key]=item[key];previous[key+'_text' if key!='price' else 'price_text']=item[key+'_text' if key!='price' else 'price_text']
            previous['words']+=item['words']
        else: anchors.append(item)
    if not anchors: return []
    # Infer the name lane from actual prices, rather than the horizontal centre
    # of a long, left-aligned heading. Numeric columns may appear in any order.
    ordered=sorted(mapping,key=lambda k:mapping[k].cx)
    name_index=ordered.index('name')
    left=(mapping[ordered[name_index-1]].x1+mapping['name'].x0)/2 if name_index else 0
    following=ordered[name_index+1] if name_index+1<len(ordered) else None
    right=width if following is None else bounds(mapping,following,width,vertical)[0]
    if following in ('price','quantity','total'):
        starts=[]
        for a in anchors:
            cell=financial_values(a['words'],mapping,width,vertical).get(following)
            if cell: starts.append(cell[2].x0)
        if starts: right=min(starts)-3
    name_words=[w for w in selected if left<=w.cx<right]
    name_lines=[joined(line) for line in visual_lines(name_words)]
    separators=[top]
    for previous,current in zip(anchors,anchors[1:]):
        midpoint=(previous['cy']+current['cy'])/2
        borders=[y for y in horizontal if previous['cy']+3<y<current['cy']-3]
        if borders: separators.append(min(borders,key=lambda y:abs(y-midpoint)));continue
        relevant=[line for line in name_lines if previous['cy']-30<line.cy<current['cy']+30]
        gaps=[(b.y0-a.y1,(a.y1+b.y0)/2) for a,b in zip(relevant,relevant[1:]) if previous['cy']+3<(a.y1+b.y0)/2<current['cy']-3]
        separators.append(max(gaps,key=lambda gap:gap[0])[1] if gaps and max(g[0] for g in gaps)>3 else midpoint)
    last=anchors[-1]['cy']
    separators.append(min((y for y in horizontal if last+5<y<bottom),default=min(bottom,last+70)))
    photos=page.get_image_info(xrefs=True)
    rows=[]
    for index,anchor in enumerate(anchors):
        start,end=separators[index:index+2]
        own_name=[w for w in name_words if start<=w.cy<end]
        name=name_text(own_name)
        if not name or re.match(r'^(итого|всего|к\s*оплате|total|subtotal|ндс|vat)\b',name,re.I): continue
        qty=anchor['quantity'];price=anchor['price'];total=anchor['total']
        prefix=f'Страница {page.number+1}, «{name[:65]}»'
        if qty is None or qty<=0 or (price is None and total is None) or (price is not None and price<0):
            warnings.append(prefix+': строка пропущена — не удалось достоверно определить цену или количество.');continue
        issues=[]
        if price is None and 'price' in mapping:
            warnings.append(prefix+': строка пропущена — не удалось прочитать колонку цены.');continue
        if price is None:
            price=money(total/qty)
            issues.append('Цена за единицу рассчитана из суммы и количества; проверьте округление.')
        row_words=[w for w in selected if start<=w.cy<end]
        discount=None
        discount_text=''
        if 'discount' in mapping:
            value,discount_text=financial_cell(anchor['words'],mapping,'discount',width,vertical)
            if value is not None and 0<=value<=100 and ('%' in discount_text or '%' in mapping['discount'].text): discount=value
            elif discount_text: issues.append('Скидка не указана в процентах; задайте её вручную.')
        if 'price' in mapping and re.search(r'соскид|послескид|discounted|netprice',normalized(mapping['price'].text)):
            if discount: issues.append('Перенесена цена после скидки; повторная скидка не применяется.')
            discount=Decimal(0)
        expected=money(money(price*qty)*(1-(discount or Decimal(0))/100))
        if total is not None and abs(expected-total)>Decimal('.005'):
            issues.append(f'Сумма в PDF {money(total)} не совпадает с расчётом {expected}. Проверьте цену, количество и скидку.')
        unit='шт'
        if 'unit' in mapping:
            ul,ur=bounds(mapping,'unit',width,vertical)
            unit_string=' '.join(w.text for w in row_words if ul<=w.cx<ur and strict_number(w.text) is None and w.text not in ('₽','$','€','%'))
            if normalized(unit_string) in ('м','m','пм','погм','метр','метры','метра'): unit='м'
            elif unit_string and normalized(unit_string) not in ('шт','штука','штуки','штук','pcs','pc','штуч'): issues.append('Единица «'+unit_string+'» перенесена как шт; проверьте единицу и количество.')
        if re.search(r'(?i)(?:\d\s*)(?:пог\.?\s*м\.?|м|m)\s*$',anchor['quantity_text']): unit='м'
        sku=''
        if 'sku' in mapping:
            sl,sr=bounds(mapping,'sku',width,vertical)
            sku=name_text([w for w in row_words if sl<=w.cx<sr])
        else:
            # References commonly print a smaller article below the product name.
            # It must be a separate last text line, never a guessed model substring.
            nl=visual_lines(own_name)
            if len(nl)>1:
                final=joined(nl[-1]);earlier=[w for line in nl[:-1] for w in line]
                typical=sum(w.y1-w.y0 for w in earlier)/len(earlier)
                if final.y1-final.y0<typical*.86:
                    sku=final.text;name=name_text(earlier)
        row={'name':name,'sku':sku,'quantity':qty,'unit_price':price,'unit':unit,
             'currency':currency(anchor['price_text']+' '+anchor['total_text']+' '+mapping.get('price',mapping.get('total')).text),
             'discount':discount,'_page':page.number+1,'_source_total':total,'_issues':issues}
        for info in photos:
            rect=pymupdf.Rect(info['bbox'])
            if 5<rect.width<110 and 5<rect.height<110 and start<=rect.y0<end and rect.x1<right:
                scale=min(2,200/max(rect.width,rect.height))
                pix=page.get_pixmap(clip=rect,matrix=pymupdf.Matrix(scale,scale),alpha=False)
                row['image']='data:image/png;base64,'+base64.b64encode(pix.tobytes('png')).decode();break
        for issue in issues: warnings.append(prefix+': '+issue)
        rows.append(row)
    return rows


def extract_pdf_rows(data,warnings):
    rows=[];previous=None;previous_width=None;empty_pages=[]
    with pymupdf.open(stream=data,filetype='pdf') as document:
        if document.needs_pass: raise ValueError('PDF защищён паролем')
        if len(document)>100: raise ValueError('В PDF больше 100 страниц')
        for page in document:
            # Remove duplicate overprinted text (frequent in bold simulated by
            # printing twice) without merging legitimate repeated item rows.
            seen={};words=[]
            for raw in page.get_text('words'):
                gx,gy=round(raw[0]*2),round(raw[1]*2)
                neighbors=[seen.get((raw[4],gx+dx,gy+dy)) for dx in (-1,0,1) for dy in (-1,0,1)]
                if any(old is not None and abs(raw[0]-old[0])<.6 and abs(raw[1]-old[1])<.6 for old in neighbors): continue
                words.append(Cell(*raw[:4],raw[4]));seen[(raw[4],gx,gy)]=raw
            if not words: empty_pages.append(page.number+1);continue
            layouts=headers(words)
            found=[]
            if layouts:
                for index,mapping in enumerate(layouts):
                    top=max(c.y1 for c in mapping.values())+1
                    bottom=min(c.y0 for c in layouts[index+1].values()) if index+1<len(layouts) else page.cropbox.height
                    found.extend(extract_page(page,words,mapping,top,bottom,warnings))
                previous=layouts[-1];previous_width=page.cropbox.width
            elif previous and abs(previous_width-page.cropbox.width)<3:
                found=extract_page(page,words,previous,0,page.cropbox.height,warnings)
            if not found:
                # Ruled grids with merged headings sometimes expose better cell
                # boundaries than their text. Do not silently drop such tables.
                from .quotation_import import recognized_rows
                for table in page.find_tables().tables:
                    found.extend(recognized_rows(table.extract(),warnings))
                if not found:
                    for table in page.find_tables(strategy='text',min_words_vertical=2,min_words_horizontal=1).tables:
                        found.extend(recognized_rows(table.extract(),warnings))
                if found:
                    for row in found: row['_page']=page.number+1
                elif any(re.search(r'\d+[,.]\d{2}',w.text) for w in words):
                    warnings.append(f'Страница {page.number+1}: таблица не распознана. Проверьте, не пропущены ли позиции.')
            rows.extend(found)
        if len(empty_pages)==len(document):
            raise ValueError('PDF содержит сканы без текста. Сначала распознайте текст (OCR) либо используйте Excel или Word (.docx).')
        if empty_pages: warnings.append('Страницы без текстового слоя (сканы), не импортированы: '+', '.join(map(str,empty_pages))+'. Для них требуется OCR.')
    return rows
