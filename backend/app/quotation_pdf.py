"""Portrait quotation in the supplied LED-Profi reference style."""
import base64
from datetime import date
from decimal import Decimal
import pymupdf
from .quotations import totals

GREEN=(0,.72,.23)
DARK=(.06,.09,.11)
GRAY=(.48,.53,.59)
LINE=(.84,.87,.90)
WHITE=(1,1,1)


def number(value,digits=2):
    return f'{Decimal(str(value)):,.{digits}f}'.replace(',',' ').replace('.',',')


def currency(code):
    return {'RUB':'₽','USD':'$','EUR':'€'}.get(code,code)


def export_quotation(quote,mode,font_path):
    result=totals(quote,mode)
    doc=pymupdf.open()
    font=pymupdf.Font(fontfile=str(font_path))
    width,height=pymupdf.paper_size('a4')
    margin=32
    usable=width-2*margin
    page=None
    y=0
    bottom=height-35
    columns=([26,usable-26-75-35-26-86,75,35,26,86] if mode=='client'
        else [26,usable-26-65-35-26-42-86,65,35,26,42,86])
    headings=(['№','НАИМЕНОВАНИЕ','ЦЕНА','КОЛ-ВО','ЕД.','СУММА'] if mode=='client'
        else ['№','НАИМЕНОВАНИЕ','ЦЕНА','КОЛ-ВО','ЕД.','СКИДКА','СУММА'])

    def text(x,baseline,value,size=8,color=DARK,bold=False):
        page.insert_text((x,baseline),str(value),fontname='Quote',fontsize=size,color=color,
            render_mode=2 if bold else 0,border_width=.16 if bold else 0)

    def wrap(value,max_width,size=8):
        output=[]
        for paragraph in str(value or '').split('\n'):
            line=''
            for word in paragraph.split():
                if line and font.text_length(line+' '+word,fontsize=size)>max_width:
                    output.append(line);line=''
                # Long articles/URLs must not escape their column.
                while font.text_length(word,fontsize=size)>max_width:
                    cut=1
                    while cut<len(word) and font.text_length(word[:cut+1],fontsize=size)<=max_width: cut+=1
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
        nonlocal page,y
        page=doc.new_page(width=width,height=height)
        page.insert_font(fontname='Quote',fontfile=str(font_path))
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
            size=5.5
            offset=6 if index<2 else max(2,col_width-font.text_length(heading,fontsize=size)-5)
            text(x+offset,y+14,heading,size,GRAY)
            x+=col_width
        y+=28

    new_page()
    # Dark masthead with a green edge and the company's editable contact details.
    page.draw_rect(pymupdf.Rect(0,0,width,114),fill=DARK,color=None)
    for step in range(18):
        left=width*.62+step*width*.38/18
        shade=(.06,.09+.16*step/18,.11+.02*step/18)
        page.draw_rect(pymupdf.Rect(left,0,min(width,left+width*.38/18+1),112),fill=shade,color=None)
    page.draw_line((0,114),(width,114),color=GREEN,width=2)
    if not image(quote.logo,pymupdf.Rect(margin,20,165,91)):
        words=quote.seller.split()
        wordmark='ЛЭД\nПРОФИ' if quote.seller.strip().casefold() in ('лэд-профи','лэд профи') else quote.seller
        logo_lines=wrap(wordmark,135,22)[:2]
        for index,part in enumerate(logo_lines): text(margin,51+index*24,part,22,WHITE,True)
        page.draw_line((105,91),(150,38),color=GREEN,width=8)
        page.draw_circle((152,36),3,color=WHITE,fill=WHITE)
    page.draw_line((180,33),(180,82),color=(.3,.34,.36),width=.5)
    for index,part in enumerate(wrap(quote.slogan,140,7)[:4]): text(197,46+index*12,part,7,(.7,.73,.75),True)
    for index,(value,color) in enumerate([(quote.city,(.7,.77,.73)),(quote.phone,GREEN),(quote.website,WHITE),(quote.email,GREEN)]):
        for part in wrap(value,190,8)[:1]: text(370,34+index*19,part,8,color,index in (1,3))

    # First-page title, recipient and the rounded information card.
    title_lines=wrap(quote.title,210,21)
    if len(title_lines)>4: title_lines=wrap(quote.title,210,16)
    for index,part in enumerate(title_lines[:5]): text(margin,166+index*24,part,21 if len(title_lines)<=4 else 16,DARK,True)
    title_end=166+min(5,len(title_lines))*24
    text(margin,title_end+1,'№ КП '+quote.number,16,DARK,True)
    card=pymupdf.Rect(260,148,width-margin,216)
    page.draw_rect(card,fill=WHITE,color=LINE,width=.6)
    labels=['ДАТА','СРОК ДЕЙСТВИЯ','ПОЗИЦИЙ']
    values=[date.fromisoformat(quote.date).strftime('%d.%m.%Y'),str(quote.valid_days)+' дней',str(len(quote.lines))+' шт']
    col=(card.width-24)/3
    for index,(label,value) in enumerate(zip(labels,values)):
        x=card.x0+12+index*col
        for j,part in enumerate(wrap(label,col-10,6)): text(x,170+j*7,part,6,GREEN,True)
        text(x,196,value,8,DARK,True)
        if index: page.draw_line((x-9,163),(x-9,201),color=LINE,width=.7)
    y=max(270,title_end+25)
    text(margin,y,'КОМУ',6,GRAY,True);y+=13
    for part in wrap(quote.customer,usable,10):
        text(margin,y,part,10,DARK,True);y+=13
    for part in wrap(quote.contact,usable,8):
        text(margin,y,part,8,GRAY);y+=11
    y=max(340,y+15)
    bar_height=max(70,35+len(result['totals'])*24)
    page.draw_rect(pymupdf.Rect(margin,y,width-margin,y+bar_height),fill=DARK,color=None)
    text(margin+22,y+bar_height/2+3,'ИТОГО ПО КП',8,(.7,.73,.75),True)
    for index,(code,values_for_currency) in enumerate(result['totals'].items()):
        amount=number(values_for_currency['total'])+' '+currency(code)
        size=min(27,245/max(1,font.text_length(amount,fontsize=1)))
        text(width-margin-22-font.text_length(amount,fontsize=size),y+28+index*24,amount,size,GREEN,True)
    if quote.tax_note:
        size=6.5
        tax=wrap(quote.tax_note,250,size)[0]
        text(width-margin-22-font.text_length(tax,fontsize=size),y+bar_height-9,tax,size,GRAY)
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
            text(x+8,y+15,'+',11,GREEN)
            title=wrap(benefit.title,benefit_width-38,6.5)
            details=wrap(benefit.text,benefit_width-38,6)
            for j,part in enumerate(title): text(x+31,y+3+j*8,part,6.5,DARK,True)
            for j,part in enumerate(details): text(x+31,y+5+len(title)*8+j*8,part,6,GRAY)
            largest=max(largest,(len(title)+len(details))*8+10)
        y+=max(45,largest);line(y);y+=22
    if y+70>bottom: new_page()
    table_heading()

    for index,(line_item,row) in enumerate(zip(quote.lines,result['lines']),1):
        # Product photo is aligned beside its name; article and manufacturer are secondary.
        photo_width=33 if line_item.image else 0
        details=line_item.name
        if line_item.sku: details+='\n'+line_item.sku
        if line_item.manufacturer: details+=' · '+line_item.manufacturer
        if line_item.room: details+='\n'+line_item.room
        if line_item.description: details+='\n'+line_item.description
        quantity=number(line_item.quantity,3).rstrip('0').rstrip(',')
        cells=[str(index),details,number(line_item.unit_price)+' '+currency(line_item.currency),quantity,line_item.unit]
        if mode=='partner': cells.append(number(row['effective_discount'])+'%')
        cells.append(number(row['total'])+' '+currency(line_item.currency))
        wrapped=[wrap(value,columns[i]-10-(photo_width if i==1 else 0),7.5) for i,value in enumerate(cells)]
        lines_count=max(len(value) for value in wrapped)
        offset=0
        while offset<lines_count:
            if y+36>bottom: new_page();table_heading()
            fit=max(1,int((bottom-y-14)/10))
            count=min(lines_count-offset,fit)
            row_height=max(40,count*10+14)
            x=margin
            if offset==0 and line_item.image:
                image(line_item.image,pymupdf.Rect(margin+columns[0]+3,y+7,margin+columns[0]+31,y+35))
            for col_index,col_width in enumerate(columns):
                values=wrapped[col_index][offset:offset+count]
                for j,value in enumerate(values):
                    color=GREEN if col_index==len(columns)-1 else GRAY if col_index in (0,2,4) else DARK
                    right=col_index not in (0,1)
                    xpos=x+col_width-5-font.text_length(value,fontsize=7.5) if right else x+5+(photo_width if col_index==1 else 0)
                    text(xpos,y+14+j*10,value,7.5,color,col_index in (3,len(columns)-1))
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
        text((width-font.text_length(part,fontsize=11))/2,y,part,11,DARK,True);y+=16
    footer=[quote.address,'Тел.: '+quote.phone+'  |  e-mail: '+quote.email+'  |  '+quote.website]
    for value in footer:
        if not value: continue
        for part in wrap(value,usable,7.5):
            text((width-font.text_length(part,fontsize=7.5))/2,y,part,7.5,GRAY);y+=11
    for number_page,sheet in enumerate(doc,1):
        sheet.insert_text((width-margin-45,height-15),f'{number_page} / {len(doc)}',fontname='Quote',fontsize=7,color=GRAY)
    doc.set_metadata({'title':quote.title+' № '+quote.number,'author':quote.seller,'subject':'Коммерческое предложение'})
    output=doc.tobytes(garbage=4,deflate=True)
    doc.close()
    return output
