import {PLAN_RADIUS} from "./planSymbols";
import {PlanSymbol} from "./PlanSymbol";
export {PlanSymbol,GlyphDefinitions} from "./PlanSymbol";
import type {PlanKind} from "./planDomain";
import {memo,useEffect,useState} from 'react';
import SearchSelect from './SearchSelect';
import {ToolButton} from './ToolRail';
export type Parameters=Record<string,unknown>;
export const appearanceKeys=['display_name','plan_icon','plan_color','plan_shape','plan_size','plan_rotation','plan_label_color','plan_label_size','plan_label_visible','line_width','line_dash'];
export const shapeChoices=[['circle','Круг'],['square','Квадрат'],['rectangle','Прямоугольник'],['diamond','Ромб'],['triangle','Треугольник'],['hexagon','Шестиугольник'],['cross','Крест'],['socket','Розетка'],['switch','Выключатель'],['lamp','Светильник'],['sensor','Датчик']];
export function AppearanceEditor({value,onChange,color,power=false,line=false,electrical=false,allowName=true,partial=false,kind}:{value:Parameters;onChange:(value:Parameters)=>void;color:string;power?:boolean;line?:boolean;electrical?:boolean;allowName?:boolean;partial?:boolean;kind?:PlanKind}) {
  const [hex,setHex]=useState(String(value.plan_color??color)),[hexError,setHexError]=useState('');
  useEffect(()=>{setHex(String(value.plan_color??color));},[value.plan_color,color]);
  const set=(key:string,next:unknown)=>{const result={...value};if(next===''&&['plan_icon','display_name'].includes(key))result[key]='';else if(next===''||next===undefined){if(partial)result[key]=null;else delete result[key];}else result[key]=next;onChange(result);};
  const number=(key:string,label:string,defaultValue:number,min:number,max:number,step=1)=><label>{label}<input aria-label={label} type="number" min={min} max={max} step={step} value={String(value[key]??defaultValue)} onChange={event=>set(key,event.target.value===''?undefined:Number(event.target.value))}/></label>;
  return <div className="appearance-editor">
    <div className="appearance-preview"><svg viewBox="-36 -36 72 72"><PlanSymbol preview kind={kind} parameters={value} radius={10} power={power} color={String(value.plan_color??color)}/></svg></div>
    {allowName&&<label>Своё название позиции<input aria-label="Своё название объекта" maxLength={200} placeholder="Название из номенклатуры" value={String(value.display_name??'')} onChange={event=>set('display_name',event.target.value)}/></label>}
    <label>Символ / надпись<input aria-label={electrical?'Иконка электроустановки':'Иконка объекта'} maxLength={12} placeholder="R, TV, LED, БП…" value={String(value.plan_icon??'')} onChange={event=>set('plan_icon',event.target.value)}/></label>
    <label>Форма значка<SearchSelect aria-label="Форма обозначения" value={String(value.plan_shape??'')} onChange={event=>set('plan_shape',event.target.value)}><option value="">По умолчанию</option>{shapeChoices.map(([key,label])=><option key={key} value={key}>{label}</option>)}</SearchSelect></label>
    <label>Цвет обозначения<span className="color-editor"><input aria-label={electrical?'Цвет обозначения электроустановки':'Цвет объекта'} type="color" value={String(value.plan_color??color)} onChange={event=>set('plan_color',event.target.value)}/><input aria-label="Код цвета объекта" pattern="#[0-9a-fA-F]{6}" maxLength={7} value={hex} onChange={event=>setHex(event.target.value)} onBlur={()=>{if(/^#[0-9a-f]{6}$/i.test(hex)){setHexError('');set('plan_color',hex);}else setHexError('Укажите цвет в формате #RRGGBB');}}/></span></label>
    {hexError&&<p role="alert" className="manual-error">{hexError}</p>}
    <div className="field-pair">{number('plan_size','Размер значка',1,.25,4,.05)}{number('plan_rotation','Поворот значка, °',0,-180,180)}</div>
    {line&&<><div className="field-pair">{number('line_width','Толщина линии',2,.25,20,.25)}<label>Стиль линии<SearchSelect aria-label="Стиль линии" value={String(value.line_dash??'solid')} onChange={event=>set('line_dash',event.target.value)}><option value="solid">Сплошная</option><option value="dashed">Штриховая</option><option value="dotted">Пунктир</option></SearchSelect></label></div></>}
    <label className="check"><input type="checkbox" aria-label="Показывать подпись объекта" checked={value.plan_label_visible!==false} onChange={event=>set('plan_label_visible',event.target.checked)}/>Подпись на плане</label>
    <div className="field-pair">{number('plan_label_size','Размер подписи',7,5,40,.5)}<label>Цвет подписи<input aria-label="Цвет подписи" type="color" value={String(value.plan_label_color??'#0f172a')} onChange={event=>set('plan_label_color',event.target.value)}/></label></div>
    {!partial&&<ToolButton type="button" icon="refresh" onClick={()=>{const result={...value};for(const key of appearanceKeys)if(key!=='display_name'||allowName)delete result[key];onChange(result);}}>Сбросить оформление</ToolButton>}
  </div>;
}
export function CustomFieldsEditor({value,onChange}:{value:Parameters;onChange:(value:Parameters)=>void}) {
  const [name,setName]=useState(''),[kind,setKind]=useState('text'),[error,setError]=useState('');
  const fields=Object.entries(value).filter(([key])=>key.startsWith('custom:'));
  return <details className="manual-properties"><summary>Свои характеристики · {fields.length}</summary>{fields.map(([key,current])=><label key={key}>{key.slice(7)}<span className="custom-field">{typeof current==='boolean'?<input aria-label={'Характеристика: '+key.slice(7)} type="checkbox" checked={current} onChange={event=>onChange({...value,[key]:event.target.checked})}/>:<input aria-label={'Характеристика: '+key.slice(7)} type={typeof current==='number'?'number':'text'} step="any" value={String(current)} onChange={event=>onChange({...value,[key]:typeof current==='number'?Number(event.target.value):event.target.value})}/>}<button type="button" aria-label={'Удалить характеристику '+key.slice(7)} onClick={()=>{const result={...value};delete result[key];onChange(result);}}>×</button></span></label>)}
    <label>Название характеристики<input aria-label="Название своей характеристики" maxLength={80} value={name} onChange={event=>setName(event.target.value)}/></label>
    <label>Тип значения<SearchSelect aria-label="Тип своей характеристики" value={kind} onChange={event=>setKind(event.target.value)}><option value="text">Текст</option><option value="number">Число</option><option value="boolean">Да / нет</option></SearchSelect></label>
    <ToolButton icon="plus" type="button" onClick={()=>{const key='custom:'+name.trim();if(!name.trim()||key in value){setError('Укажите новое название характеристики');return;}onChange({...value,[key]:kind==='number'?0:kind==='boolean'?false:''});setName('');setError('');}}>Добавить характеристику</ToolButton>{error&&<p role="alert" className="manual-error">{error}</p>}
  </details>;
}
type Point={x:number;y:number};
export function CoordinateEditor({item,page,onChange}:{item:{x:number;y:number;geometry?:{points?:Point[]}|null};page:{width:number;height:number;meters_per_point:number|null};onChange:(change:{x:number;y:number;geometry?:{points?:Point[]}})=>void}) {
  const mx=page.meters_per_point?page.width*page.meters_per_point*1000:100,my=page.meters_per_point?page.height*page.meters_per_point*1000:100,unit=page.meters_per_point?'мм':'%';
  const source=item.geometry?.points?.length?item.geometry.points:[{x:item.x,y:item.y}];
  const [points,setPoints]=useState(source.map(point=>({x:String(Math.round(point.x*mx*1000)/1000),y:String(Math.round(point.y*my*1000)/1000)}))),[error,setError]=useState('');
  const fingerprint=JSON.stringify(source);
  useEffect(()=>{setPoints(source.map(point=>({x:String(Math.round(point.x*mx*1000)/1000),y:String(Math.round(point.y*my*1000)/1000)})));},[fingerprint,mx,my]);
  return <details className="manual-properties"><summary>Координаты вручную · {unit}</summary><p className="hint">От левого верхнего угла листа. Для линии можно изменить каждый узел.</p><table><thead><tr><th>Точка</th><th>X, {unit}</th><th>Y, {unit}</th>{item.geometry?.points?.length&&<th style={{width:28}}/>}</tr></thead><tbody>{points.map((point,index)=><tr key={index}><td>{index+1}</td>{(['x','y'] as const).map(axis=><td key={axis}><input aria-label={`Координата ${axis.toUpperCase()} точки ${index+1}`} type="number" step="any" min="0" max={axis==='x'?mx:my} value={point[axis]} onChange={event=>setPoints(points.map((p,i)=>i===index?{...p,[axis]:event.target.value}:p))}/></td>)}{item.geometry?.points?.length&&<td><button type="button" aria-label={"Удалить узел "+(index+1)} disabled={points.length<=2} onClick={()=>setPoints(points.filter((_,i)=>i!==index))}>×</button></td>}</tr>)}</tbody></table>
    {Boolean(item.geometry?.points?.length)&&<ToolButton icon="plus" type="button" disabled={points.length>=1000} onClick={()=>{const before=points[points.length-2],last=points[points.length-1],middle={x:String((Number(before.x)+Number(last.x))/2),y:String((Number(before.y)+Number(last.y))/2)};setPoints([...points.slice(0,-1),middle,last]);}}>Добавить узел</ToolButton>}
    <ToolButton icon="edit" type="button" onClick={()=>{const parsed=points.map(point=>({x:Number(point.x)/mx,y:Number(point.y)/my}));if(points.some(p=>p.x===''||p.y==='')||parsed.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1)){setError('Координаты должны находиться в пределах листа');return;}setError('');onChange({...parsed[0],...(item.geometry?.points?.length?{geometry:{...item.geometry,points:parsed}}:{})});}}>Применить координаты</ToolButton>{error&&<p role="alert" className="manual-error">{error}</p>}
  </details>;
}

export function PointMarker({scale,color,selected,icon,powerSupply=false,parameters={},kind,shared=false,details=true}:{scale:number;color:string;selected:boolean;icon:string;powerSupply?:boolean;parameters?:Record<string,unknown>;kind?:PlanKind;shared?:boolean;details?:boolean}) {
  return <g className={"point-symbol "+(selected?"selected-object":"")}>
    {selected&&<><circle className="selection-halo" r={(powerSupply?18:PLAN_RADIUS+5)*scale*Number(parameters.plan_size??1)} fill="#38bdf8" fillOpacity=".2" stroke="#0284c7" strokeWidth="5" vectorEffect="non-scaling-stroke"/><circle className="selection-ring" r={(powerSupply?15:PLAN_RADIUS+2)*scale*Number(parameters.plan_size??1)} fill="none" stroke="white" strokeWidth="3" vectorEffect="non-scaling-stroke"/></>}
    <PlanSymbol details={details} shared={shared} kind={kind} parameters={{...parameters,plan_icon:icon}} color={color} selected={selected} power={powerSupply} radius={PLAN_RADIUS*scale}/>
  </g>;
}
