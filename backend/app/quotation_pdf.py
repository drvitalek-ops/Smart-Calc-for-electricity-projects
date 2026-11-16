"""Portrait quotation in the supplied LED-Profi reference style."""
import base64
import math
from datetime import date
from decimal import Decimal
from pathlib import Path
from functools import lru_cache
import pymupdf
from .quotations import totals

GREEN=(0,.72,.23)
DARK=(14/255,20/255,24/255)
ASSETS=Path(__file__).resolve().parent / "assets"
GRAY=(.48,.53,.59)
LINE=(.84,.87,.90)
WHITE=(1,1,1)
TABLE_TEXT_SCALE=1.05


def number(value,digits=2):
    return f'{Decimal(str(value)):,.{digits}f}'.replace(',',' ').replace('.',',')


def currency(code):
    return {'RUB':'₽','USD':'$','EUR':'€'}.get(code,code)


def item_details(item):
    import re
    ip_pattern=r'^\s*(?:степень\s+защиты\s*[:：]?\s*(?:IP\s*)?|IP\s*[:：]?\s*)([0-6X][0-9X]K?)(?=$|[\s;,.])'
    statuses=[];description=[]
    if item.ip.strip():statuses.append('IP'+re.sub(r'^IP\s*','',item.ip.strip(),flags=re.I).upper())
    for part in item.description.splitlines():
        found=re.match(ip_pattern,part,re.I)
        if found:
            if not statuses:statuses.append('IP'+found[1].upper())
            rest=part[found.end():].strip(' ;,.')
            if rest:description.append(rest)
        else:description.append(re.sub(r'^\s*артикул\s*[:：]\s*','',part,flags=re.I))
    sku=re.sub(r'^\s*(?:артикул(?:\s*[:：№#]\s*|\s+)|SKU\s*[:：]\s*)','',item.sku,flags=re.I).strip()
    metadata=' · '.join(filter(None,[sku,*statuses,item.manufacturer.strip()]))
    return '\n'.join(filter(None,[item.name,metadata,'\n'.join(description),('Комментарий: '+item.comment) if item.comment else '']))


def export_quotation(quote,mode,font_path=None):
    result=totals(quote,mode)
    doc=pymupdf.open()
    font_paths={name:ASSETS / 'fonts' / ('GolosText-'+weight+'.ttf')
        for name,weight in [('Quote','Regular'),('QuoteBold','Bold'),('QuoteBlack','Black')]}
    fonts={name:pymupdf.Font(fontfile=str(path)) for name,path in font_paths.items()}
    font=fonts['Quote']
    width,height=pymupdf.paper_size('a4')
    margin=32
    usable=width-2*margin
    page=None
    text_shape=None
    y=0
    bottom=height-35
    columns=([26,usable-26-75-35-26-86,75,35,26,86] if mode=='client'
        else [26,usable-26-65-35-26-42-86,65,35,26,42,86])
    cell_font=7.5*TABLE_TEXT_SCALE
    cell_leading=10*TABLE_TEXT_SCALE
    group_font=8.5*TABLE_TEXT_SCALE
    group_leading=11*TABLE_TEXT_SCALE
    headings=(['№','НАИМЕНОВАНИЕ','ЦЕНА','КОЛ-ВО','ЕД.','СУММА'] if mode=='client'
        else ['№','НАИМЕНОВАНИЕ','ЦЕНА','КОЛ-ВО','ЕД.','СКИДКА','СУММА'])

    @lru_cache(maxsize=4096)
    def measure(value,size=8,face='Quote'):
        return fonts[face].text_length(value,fontsize=size)

    def text(x,baseline,value,size=8,color=DARK,bold=False,face=None):
        # A single text stream per page avoids rebuilding the page for every cell.
        face=face or ('QuoteBlack' if bold and size>=16 else 'QuoteBold' if bold else 'Quote')
        text_shape.insert_text((x,baseline),str(value),fontname=face,fontsize=size,color=color)

    def wrap(value,max_width,size=8):
        output=[]
        for paragraph in str(value or '').split('\n'):
            line=''
            for word in paragraph.split():
                if line and measure(line+' '+word,size)>max_width:
                    output.append(line);line=''
                # Long articles/URLs must not escape their column.
                while measure(word,size)>max_width:
                    cut=1
                    while cut<len(word) and measure(word[:cut+1],size)<=max_width: cut+=1
                    if line: output.append(line);line=''
                    output.append(word[:cut]);word=word[cut:]
                line=(line+' '+word).strip()
            output.append(line)
        return output or ['']

    def image(value,rect):
        if not value: return False
        try:
            raw=base64.b64decode(value.split(',',1)[1],validate=True)
            page.insert_image(rect,stream=raw,keep_proportion=True)
            return True
        except Exception:
            return False

    def new_page():
        nonlocal page,y,text_shape
        if text_shape is not None: text_shape.commit()
        page=doc.new_page(width=width,height=height)
        page.draw_rect(page.rect,color=None,fill=WHITE)
        for name,path in font_paths.items(): page.insert_font(fontname=name,fontfile=str(path))
        text_shape=page.new_shape()
        y=28

    def line(ypos):
        page.draw_line((margin,ypos),(width-margin,ypos),color=LINE,width=.7)

    def block(value,size=8,color=DARK):
        nonlocal y
        for value_line in wrap(value,usable,size):
            if y+size*1.45>bottom: new_page()
            text(margin,y+size,value_line,size,color)
            y+=size*1.45

    def table_heading():
        nonlocal y
        page.draw_rect(pymupdf.Rect(margin,y,width-margin,y+24),color=None,fill=(.95,.96,.97))
        x=margin
        for index,(heading,col_width) in enumerate(zip(headings,columns)):
            size=5.5*TABLE_TEXT_SCALE
            offset=6 if index<2 else max(2,col_width-measure(heading,size)-5)
            text(x+offset,y+14,heading,size,GRAY)
            x+=col_width
        y+=28

    def group_heading(name):
        nonlocal y
        parts=wrap(name,usable-16,group_font)
        height=max(22,10+len(parts)*group_leading)
        page.draw_rect(pymupdf.Rect(margin,y,width-margin,y+height),fill=(.93,.97,.95),color=None)
        for index,part in enumerate(parts):text(margin+8,y+14+index*group_leading,part,group_font,DARK,True)
        y+=height+3

    new_page()
    # Dark masthead with a green edge and the company's editable contact details.
    page.draw_rect(pymupdf.Rect(0,0,width,114),fill=DARK,color=None)
    for step in range(18):
        left=width*.62+step*width*.38/18
        shade=(.06,.09+.16*step/18,.11+.02*step/18)
        page.draw_rect(pymupdf.Rect(left,0,min(width,left+width*.38/18+1),112),fill=shade,color=None)
    page.draw_line((0,114),(width,114),color=GREEN,width=2)
    if not image(quote.logo,pymupdf.Rect(margin,27,165,86)):
        if quote.seller.strip().casefold() in ('лэд-профи','лэд профи'):
            page.insert_image(pymupdf.Rect(margin,27,165,86),filename=str(ASSETS / 'led-profi-logo.png'),keep_proportion=True)
        else:
            for index,part in enumerate(wrap(quote.seller,135,20)[:2]): text(margin,51+index*24,part,20,WHITE,True)
    page.draw_line((180,33),(180,82),color=(.3,.34,.36),width=.5)
    for index,part in enumerate(wrap(quote.slogan,140,7)[:4]): text(197,46+index*12,part,7,(.7,.73,.75),True)
    for index,(value,color) in enumerate([(quote.city,(.7,.77,.73)),(quote.phone,GREEN),(quote.website,WHITE),(quote.email,GREEN)]):
        for part in wrap(value,190,8)[:1]: text(370,34+index*19,part,8,color,index in (1,3))

    # First-page title, recipient and the rounded information card.
    title_lines=wrap(quote.title,210,19)
    if len(title_lines)>4: title_lines=wrap(quote.title,210,16)
    for index,part in enumerate(title_lines[:5]): text(margin,166+index*24,part,19 if len(title_lines)<=4 else 16,DARK,True)
    title_end=166+min(5,len(title_lines))*24
    text(margin,title_end+1,'№ КП '+quote.number,16,DARK,True)
    card=pymupdf.Rect(260,148,width-margin,216)
    page.draw_rect(card,fill=WHITE,color=LINE,width=.6,radius=.16)
    labels=['ДАТА','СРОК ДЕЙСТВИЯ','ПОЗИЦИЙ']
    values=[date.fromisoformat(quote.date).strftime('%d.%m.%Y'),str(quote.valid_days)+' дней',str(len(quote.lines))+' шт']
    col=(card.width-24)/3
    for index,(label,value) in enumerate(zip(labels,values)):
        x=card.x0+12+index*col
        for j,part in enumerate(wrap(label,col-10,6)): text(x,170+j*7,part,6,GREEN,True)
        text(x,196,value,8,DARK,True)
        if index: page.draw_line((x-9,163),(x-9,201),color=LINE,width=.7)
    y=max(270,title_end+20)
    text(margin,y,'КОМУ',6,GRAY,True);y+=13
    for part in wrap(quote.customer,usable,10):
        text(margin,y,part,10,DARK,True);y+=13
    for part in wrap(quote.contact,usable,8):
        text(margin,y,part,8,GRAY);y+=11
    y=max(340,y+15)
    total_row_height=36
    bar_height=70+max(0,len(result['totals'])-1)*total_row_height
    page.draw_rect(pymupdf.Rect(margin,y,width-margin,y+bar_height),fill=DARK,color=None,radius=.16)
    text(margin+22,y+bar_height/2+3,'ИТОГО ПО КП',8,(.7,.73,.75),True)
    for index,(code,values_for_currency) in enumerate(result['totals'].items()):
        amount=number(values_for_currency['total'])+' '+currency(code)
        size=min(27,245/max(1,measure(amount,1,'QuoteBlack')))
        # Match the supplied corrected PDF: centre each amount in its own row,
        # leaving a separate line for tax. Keep the measured face when shrinking.
        row_center=y+27+index*total_row_height
        baseline=row_center+(fonts['QuoteBlack'].ascender+fonts['QuoteBlack'].descender)*size/2
        text(width-margin-22-measure(amount,size,'QuoteBlack'),baseline,amount,size,GREEN,face='QuoteBlack')
    if quote.tax_note:
        size=6.5
        tax=wrap(quote.tax_note,250,size)[0]
        text(width-margin-22-measure(tax,size),y+bar_height-9,tax,size,GRAY)
    y+=bar_height+18
    if mode=='partner':
        for code,amounts in result['totals'].items():
            text(margin,y,'Без скидки: '+number(amounts['base'])+' '+currency(code)+'    Скидка: '+number(amounts['discount'])+' '+currency(code),8,GRAY)
            y+=13
        y+=5
    if quote.benefits:
        line(y);y+=17
        benefit_width=usable/len(quote.benefits)
        largest=0
        for index,benefit in enumerate(quote.benefits):
            x=margin+index*benefit_width
            page.draw_circle((x+12,y+12),12,color=(.72,.9,.77),fill=(.94,.99,.95),width=.6)
            cx,cy=x+12,y+12
            if index==0:
                page.draw_polyline([(cx,cy-5),(cx+4,cy-3),(cx+4,cy+2),(cx,cy+6),(cx-4,cy+2),(cx-4,cy-3),(cx,cy-5)],color=GREEN,width=.7)
            elif index==1:
                points=[(cx+math.sin(i*math.pi/5)*(5 if i%2==0 else 2.4),cy-math.cos(i*math.pi/5)*(5 if i%2==0 else 2.4)) for i in range(10)]
                page.draw_polyline(points+[points[0]],color=GREEN,width=.7)
            elif index==2:
                page.draw_circle((cx,cy-1),3.1,color=GREEN,width=.7)
                page.draw_polyline([(cx-2,cy+2),(cx-1.5,cy+5),(cx+1.5,cy+5),(cx+2,cy+2)],color=GREEN,width=.7)
                page.draw_line((cx-1,cy+6),(cx+1,cy+6),color=GREEN,width=.7)
            else:
                page.draw_rect(pymupdf.Rect(cx-4,cy-4,cx+4,cy+3),color=GREEN,width=.7,radius=.15)
                page.draw_polyline([(cx-4,cy+2),(cx-4,cy+6),(cx-1,cy+3)],color=GREEN,width=.7)
            title=wrap(benefit.title,benefit_width-38,6.5)
            details=wrap(benefit.text,benefit_width-38,6)
            for j,part in enumerate(title): text(x+31,y+3+j*8,part,6.5,DARK,True)
            for j,part in enumerate(details): text(x+31,y+5+len(title)*8+j*8,part,6,GRAY)
            largest=max(largest,(len(title)+len(details))*8+10)
        y+=max(45,largest);line(y);y+=22
    if y+70>bottom: new_page()
    table_heading()

    grouped=any(item.room.strip() not in ('','Без помещения') for item in quote.lines)
    current_group=None
    for index,(line_item,row) in enumerate(zip(quote.lines,result['lines']),1):
        room=line_item.room.strip() or 'Без помещения'
        if grouped and room!=current_group:
            heading_height=max(22,10+len(wrap(room,usable-16,group_font))*group_leading)+3
            if y+heading_height+40>bottom:new_page();table_heading()
            group_heading(room);current_group=room
        # Product photo is aligned beside its name; article and manufacturer are secondary.
        photo_width=33 if line_item.image else 0
        details=item_details(line_item)
        quantity=number(line_item.quantity,3).rstrip('0').rstrip(',')
        cells=[str(index),details,number(line_item.unit_price)+' '+currency(line_item.currency),quantity,line_item.unit]
        if mode=='partner': cells.append(number(row['effective_discount'])+'%')
        cells.append(number(row['total'])+' '+currency(line_item.currency))
        wrapped=[wrap(value,columns[i]-10-(photo_width if i==1 else 0),cell_font) for i,value in enumerate(cells)]
        lines_count=max(len(value) for value in wrapped)
        offset=0
        while offset<lines_count:
            if y+36>bottom:
                new_page();table_heading()
                if grouped:group_heading(room)
            fit=max(1,int((bottom-y-14)/cell_leading))
            count=min(lines_count-offset,fit)
            row_height=max(40,count*cell_leading+14)
            x=margin
            if offset==0 and line_item.image:
                image(line_item.image,pymupdf.Rect(margin+columns[0]+3,y+7,margin+columns[0]+31,y+35))
            for col_index,col_width in enumerate(columns):
                values=wrapped[col_index][offset:offset+count]
                for j,value in enumerate(values):
                    color=GREEN if col_index==len(columns)-1 else GRAY if col_index in (0,2,4) else DARK
                    right=col_index not in (0,1)
                    xpos=x+col_width-5-measure(value,cell_font,'QuoteBold' if col_index in (3,len(columns)-1) else 'Quote') if right else x+5+(photo_width if col_index==1 else 0)
                    text(xpos,y+14+j*cell_leading,value,cell_font,color,col_index in (3,len(columns)-1))
                x+=col_width
            y+=row_height
            line(y);y+=4
            offset+=count

    y+=24
    if quote.terms:
        block('Условия предложения',9,DARK);y+=5
        block(quote.terms,8,GRAY);y+=18
    if y+100>bottom: new_page()
    line(y);y+=30
    for part in wrap(quote.seller,usable,11):
        text((width-measure(part,11,'QuoteBold'))/2,y,part,11,DARK,True);y+=16
    footer=[quote.address,'Тел.: '+quote.phone+'  |  e-mail: '+quote.email+'  |  '+quote.website]
    for value in footer:
        if not value: continue
        for part in wrap(value,usable,7.5):
            text((width-measure(part,7.5))/2,y,part,7.5,GRAY);y+=11
    text_shape.commit()
    for number_page,sheet in enumerate(doc,1):
        sheet.insert_text((width-margin-45,height-15),f'{number_page} / {len(doc)}',fontname='Quote',fontsize=7,color=GRAY)
    doc.set_metadata({'title':quote.title+' № '+quote.number,'author':quote.seller,'subject':'Коммерческое предложение'})
    output=doc.tobytes(garbage=4,deflate=True)
    doc.close()
    return output
