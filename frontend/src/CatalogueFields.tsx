import {useEffect,useRef,useState} from 'react';
import SearchInput from './SearchInput';
import {api,ApiError,errorMessage} from './errors';
import {refreshCatalogue} from './catalogueStore';
import {ActionIcon} from './ToolRail';
export const catalogueIdentity=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru').replaceAll('ё','е');
export type Maker={id:number;name:string;active?:boolean};
export type DuplicateProduct={id:number;name:string;sku:string;manufacturer_id:number;type_id:number;unit:string;price:number;currency:string;active:boolean;reason:string};
export function duplicateProducts(error:unknown):DuplicateProduct[]|null{
  if(error instanceof ApiError&&error.data&&typeof error.data==='object'&&'code' in error.data&&error.data.code==='catalog_duplicate'&&'matches' in error.data&&Array.isArray(error.data.matches))return error.data.matches as DuplicateProduct[];
  return null;
}
export function ManufacturerField({value,makers,onChange,label='Производитель',disabled=false,required=true}:{value:string;makers:Maker[];onChange:(name:string,id?:number)=>void;label?:string;disabled?:boolean;required?:boolean}){
  const [saving,setSaving]=useState(false),[error,setError]=useState('');
  const match=makers.find(item=>item.active!==false&&catalogueIdentity(item.name)===catalogueIdentity(value))??makers.find(item=>catalogueIdentity(item.name)===catalogueIdentity(value));
  async function create(){setSaving(true);setError('');try{const item=await api<Maker>(match?'/manufacturers/'+match.id:'/manufacturers',match?'PUT':'POST',match?{name:match.name,active:true}:{name:value.trim()});await refreshCatalogue();onChange(item.name,item.id);}catch(e){setError(errorMessage(e,'Не удалось добавить производителя'));}finally{setSaving(false);}}
  return <div className="manufacturer-field"><label>{label}<SearchInput aria-label={label} required={required} maxLength={500} disabled={disabled||saving} value={value} options={makers.filter(item=>item.active!==false||item.id===match?.id).map(item=>item.name)} onChange={name=>{setError('');const selected=makers.find(item=>item.active!==false&&catalogueIdentity(item.name)===catalogueIdentity(name));onChange(name,selected?.id);}}/></label>
    {value.trim()&&(!match||match.active===false)&&<button type="button" className="inline-create-manufacturer" disabled={disabled||saving} onClick={()=>void create()}><ActionIcon name="plus"/>{saving?'Сохранение…':match?'Восстановить производителя':'Добавить производителя «'+value.trim()+'»'}</button>}
    {error&&<p className="catalog-error" role="alert">{error}</p>}
  </div>;
}
export function DuplicateProducts({matches,onEdit,onSeparate,onCancel,disabled=false,canEdit=()=>true}:{matches:DuplicateProduct[];onEdit:(id:number)=>void;onSeparate:()=>void;onCancel:()=>void;disabled?:boolean;canEdit?:(item:DuplicateProduct)=>boolean}){
  const [selected,setSelected]=useState(matches[0]?.id??0),root=useRef<HTMLDivElement>(null);
  useEffect(()=>{setSelected(matches[0]?.id??0);root.current?.scrollIntoView({block:'nearest'});root.current?.focus({preventScroll:true});},[matches]);
  const candidate=matches.find(item=>item.id===selected);
  return <div className="catalogue-duplicates" role="alert" tabIndex={-1} ref={root}><strong>Найдены похожие товары</strong><p>Отредактировать выбранную позицию? Проверьте артикул и название перед созданием дубликата.</p>
    <fieldset disabled={disabled}><legend>Выберите существующий товар</legend>{matches.map(item=><label key={item.id}><input type="radio" name="catalogue-duplicate" checked={selected===item.id} onChange={()=>setSelected(item.id)}/><span><b>{item.name}</b><small>{item.sku||'Без артикула'} · {item.reason}{item.active?'':' · Архив'}{!canEdit(item)?' · Другая номенклатура или единица':''}</small></span></label>)}</fieldset>
    <div className="appearance-actions"><button type="button" disabled={disabled||!candidate||!canEdit(candidate)} onClick={()=>onEdit(selected)}>Редактировать выбранную позицию</button><button type="button" disabled={disabled} onClick={onSeparate}>Создать отдельную позицию</button><button type="button" disabled={disabled} onClick={onCancel}>Отмена</button></div>
  </div>;
}
