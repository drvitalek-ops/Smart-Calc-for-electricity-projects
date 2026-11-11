"""Shared validation and PDF rendering for editable plan annotations."""
import math
import re
import json
from pathlib import Path
from functools import lru_cache
from fastapi import HTTPException

SHAPES=('circle','square','rectangle','diamond','triangle','hexagon','cross','socket','switch','lamp','sensor')
APPEARANCE_KEYS={'display_name','plan_icon','plan_color','plan_shape','plan_size','plan_rotation','plan_label_color','plan_label_size','plan_label_visible','line_width','line_dash'}


def validate_appearance(values):
    for key,limit in (('display_name',200),('plan_icon',12)):
        if key in values and (not isinstance(values[key],str) or len(values[key])>limit):
            raise HTTPException(422,f'{key}: допустимо не больше {limit} символов')
    for key in ('plan_color','plan_label_color'):
        if key in values and (not isinstance(values[key],str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',values[key])):
            raise HTTPException(422,f'{key}: цвет должен быть в формате #RRGGBB')
    for key,low,high in (('plan_size',.25,4),('plan_rotation',-180,180),('plan_label_size',5,40),('line_width',.25,20),('manual_length',.001,1000000)):
        if key in values and (isinstance(values[key],bool) or not isinstance(values[key],(int,float)) or not math.isfinite(values[key]) or not low<=values[key]<=high):
            raise HTTPException(422,f'{key}: укажите число от {low} до {high}')
    if 'plan_shape' in values and values['plan_shape'] not in SHAPES:
        raise HTTPException(422,'Неизвестная форма обозначения')
    if 'line_dash' in values and values['line_dash'] not in ('solid','dashed','dotted'):
        raise HTTPException(422,'Неизвестный тип линии')
    if 'plan_label_visible' in values and type(values['plan_label_visible']) is not bool:
        raise HTTPException(422,'Видимость подписи должна быть логическим значением')
    for key,value in values.items():
        if key.startswith('custom:') and (not 1<=len(key[7:].strip())<=80 or not isinstance(value,(str,int,float,bool)) or isinstance(value,float) and not math.isfinite(value) or isinstance(value,str) and len(value)>2000):
            raise HTTPException(422,'Своя характеристика: название до 80 символов, значение — текст, число или Да/Нет')


def rgb(value): return tuple(int(value[i:i+2],16)/255 for i in (1,3,5))


SYMBOLS=json.loads((Path(__file__).resolve().parent/'assets'/'plan-symbols.json').read_text(encoding='utf-8'))


def _fold(value):return value.casefold().replace('ё','е')


@lru_cache(maxsize=512)
def default_glyph(name,category,seed_key=''):
    text=_fold(name+' '+(seed_key or ''))
    for rule in SYMBOLS['rules']:
        if rule.get('category') and rule['category']!=category:continue
        if rule.get('seed_contains') and _fold(rule['seed_contains']) not in _fold(seed_key or ''):continue
        if rule.get('contains') and not any(_fold(value) in text for value in rule['contains']):continue
        if rule.get('contains_all') and not all(_fold(value) in text for value in rule['contains_all']):continue
        return rule['glyph']
    return ''


def symbol_appearance(parameters,kind=None,power=False):
    chosen=parameters.get('plan_shape','')
    if chosen:glyph=chosen if chosen in ('socket','switch','lamp','sensor') else ''
    elif power:glyph='power'
    elif kind:glyph=default_glyph(kind.name,kind.category,kind.seed_key or '')
    else:glyph=''
    shape=chosen or SYMBOLS['glyphs'].get(glyph,{}).get('shape') or ('rectangle' if power else 'circle')
    return shape,'' if parameters.get('plan_icon') else glyph


def symbol_ink(color):
    channels=[value/12.92 if value<=.04045 else ((value+.055)/1.055)**2.4 for value in color]
    return (21/255,42/255,52/255) if sum(value*weight for value,weight in zip(channels,(.2126,.7152,.0722)))>.22 else (1,1,1)


def draw_marker(sheet,anchor,parameters,color,power=False,kind=None):
    import pymupdf
    size=sheet.rect.width*.012*parameters.get('plan_size',1)
    shape,glyph=symbol_appearance(parameters,kind,power)
    angle=math.radians(parameters.get('plan_rotation',0))
    def point(x,y):
        return pymupdf.Point(anchor.x+size*(x*math.cos(angle)-y*math.sin(angle)),anchor.y+size*(x*math.sin(angle)+y*math.cos(angle)))
    white=(1,1,1)
    outline=max(.45,size*1.6/12)
    if shape in ('circle','socket','switch','lamp','sensor'):
        sheet.draw_circle(anchor,size,color=white,fill=color,width=outline)
    else:
        vertices={'square':[(-1,-1),(1,-1),(1,1),(-1,1)],'rectangle':[(-1.6,-.65),(1.6,-.65),(1.6,.65),(-1.6,.65)],'diamond':[(0,-1.3),(1.3,0),(0,1.3),(-1.3,0)],'triangle':[(0,-1.3),(1.2,1),(-1.2,1)],'hexagon':[(math.cos(i*math.pi/3),math.sin(i*math.pi/3)) for i in range(6)],'cross':[(-.35,-1),(.35,-1),(.35,-.35),(1,-.35),(1,.35),(.35,.35),(.35,1),(-.35,1),(-.35,.35),(-1,.35),(-1,-.35),(-.35,-.35)]}[shape]
        vertices=[point(*v) for v in vertices]
        if shape in ('rectangle','square') and not angle:
            sheet.draw_rect(pymupdf.Rect(vertices[0],vertices[2]),color=white,fill=color,width=outline,**({'radius':.07} if shape=='square' else {}))
        else:sheet.draw_polyline(vertices+[vertices[0]],color=white,fill=color,width=outline,closePath=True)
    ink=symbol_ink(color)
    detail=SYMBOLS['glyphs'].get(glyph,{})
    for segment in detail.get('strokes',[]):sheet.draw_polyline([point(*vertex) for vertex in segment],color=ink,width=max(.45,size*.12),lineCap=1,lineJoin=1)
    for x,y,radius in detail.get('circles',[]):sheet.draw_circle(point(x,y),radius*size,color=ink,width=max(.45,size*.12))
    for x,y,radius in detail.get('squares',[]):
        vertices=[point(x-radius,y-radius),point(x+radius,y-radius),point(x+radius,y+radius),point(x-radius,y+radius)]
        sheet.draw_polyline(vertices+[vertices[0]],color=ink,width=max(.45,size*.12),closePath=True)
    icon=parameters.get('plan_icon','').strip()
    if icon:
        font_size=max(1,min(size*1.4,size*3/max(1,len(icon))))
        sheet.insert_text((anchor.x-font_size*len(icon)*.28,anchor.y+font_size*.32),icon,fontsize=font_size,fontname='CalcPlan',color=ink)
