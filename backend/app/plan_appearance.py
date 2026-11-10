"""Shared validation and PDF rendering for editable plan annotations."""
import math
import re
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


def draw_marker(sheet,anchor,parameters,color,power=False):
    import pymupdf
    size=5*parameters.get('plan_size',1)
    shape=parameters.get('plan_shape','rectangle' if power else 'circle')
    angle=math.radians(parameters.get('plan_rotation',0))
    def point(x,y):
        return pymupdf.Point(anchor.x+size*(x*math.cos(angle)-y*math.sin(angle)),anchor.y+size*(x*math.sin(angle)+y*math.cos(angle)))
    if shape in ('circle','socket','switch','lamp','sensor'):
        sheet.draw_circle(anchor,size,color=color,fill=color)
    else:
        vertices={'square':[(-1,-1),(1,-1),(1,1),(-1,1)],'rectangle':[(-1.6,-.65),(1.6,-.65),(1.6,.65),(-1.6,.65)],'diamond':[(0,-1.3),(1.3,0),(0,1.3),(-1.3,0)],'triangle':[(0,-1.3),(1.2,1),(-1.2,1)],'hexagon':[(math.cos(i*math.pi/3),math.sin(i*math.pi/3)) for i in range(6)],'cross':[(-.35,-1),(.35,-1),(.35,-.35),(1,-.35),(1,.35),(.35,.35),(.35,1),(-.35,1),(-.35,.35),(-1,.35),(-1,-.35),(-.35,-.35)]}[shape]
        vertices=[point(*v) for v in vertices]
        if shape in ('rectangle','square') and not angle:
            sheet.draw_rect(pymupdf.Rect(vertices[0],vertices[2]),color=color,fill=color)
        else: sheet.draw_polyline(vertices+[vertices[0]],color=color,fill=color,closePath=True)
    white=(1,1,1)
    segments={'socket':[((-.35,-.1),(-.35,.15)),((.35,-.1),(.35,.15))], 'switch':[((-.45,.45),(.45,-.45))], 'lamp':[((-.45,-.45),(.45,.45)),((-.45,.45),(.45,-.45))], 'sensor':[((-.5,.25),(0,-.4)),((0,-.4),(.5,.25))]}
    for a,b in segments.get(shape,[]): sheet.draw_line(point(*a),point(*b),color=white,width=max(.5,size*.13))
    icon=parameters.get('plan_icon','').strip()
    if icon:
        font_size=max(1,min(size*1.6,size*3/max(1,len(icon))))
        sheet.insert_text((anchor.x-font_size*len(icon)*.28,anchor.y+font_size*.32),icon,fontsize=font_size,fontname='CalcPlan',color=white)
