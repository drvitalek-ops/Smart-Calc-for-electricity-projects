import type {Catalog,Item,Kind,Project,Product} from './App';
import type {BulkField} from './BulkEditor';
import {appearanceKeys} from './PlanAppearance';
import {isPowerSupply,isLedStrip} from './planDomain';
export const categoriesMixed=(ids:(number|null)[],types:Kind[])=>new Set(ids.map(id=>types.find(t=>t.id===id)?.category??'Без категории')).size>1;
export function productBulkFields(items:Product[],catalog:Catalog):BulkField[]{
 const field=(key:string,label:string,values:string[],extra:Partial<BulkField>={}):BulkField=>({key,label,values,...extra});
 return [field('manufacturer_id','Производитель',items.map(p=>String(p.manufacturer_id)),{type:'select',options:catalog.manufacturers.filter(m=>m.active!==false).map(m=>({value:String(m.id),label:m.name}))}),field('supplier_id','Поставщик',items.map(p=>p.supplier_id?String(p.supplier_id):''),{type:'select',emptyLabel:'Без поставщика',options:catalog.suppliers.map(s=>({value:String(s.id),label:s.name}))}),field('price','Цена',items.map(p=>String(p.price)),{type:'decimal'}),field('currency','Валюта',items.map(p=>p.currency),{maxLength:3}),field('active','Доступен для выбора',items.map(p=>p.active?'true':'false'),{type:'select',options:[{value:'true',label:'Да'},{value:'false',label:'Нет · архив'}]}),field('parameters.ip','IP',items.map(p=>String(p.parameters.ip??'')),{maxLength:16}),field('parameters.description','Описание',items.map(p=>String(p.parameters.description??'')),{maxLength:2000})];
}
export function planBulkFields(items:Item[],project:Project,types:Kind[],catalog:Catalog):BulkField[]{
 if(!items.length)return [];
 const fields:BulkField[]=[{key:'comment',label:'Комментарий',values:items.map(i=>i.comment)},{key:'room_id',label:'Помещение',values:items.map(i=>i.room_id?String(i.room_id):''),type:'select',emptyLabel:'Без помещения',options:project.rooms.filter(r=>r.page_id===null||items.every(i=>i.page_id===r.page_id)).map(r=>({value:String(r.id),label:r.name}))},{key:'layer_id',label:'Слой',values:items.map(i=>String(i.layer_id)),type:'select',options:project.layers.filter(l=>!l.locked).map(l=>({value:String(l.id),label:l.name}))}];
 const kinds=items.map(i=>types.find(t=>t.id===i.type_id));

 {
  const omit=new Set([...appearanceKeys,'frame_group','frame_posts','led_strip_id','led_strip_ids','length','manual_length','measured_length']);
  const records=items.map((item,index)=>({...kinds[index]?.defaults,...item.parameters}));
  const common=Object.keys(records[0]??{}).filter(key=>!omit.has(key)&&records.every(record=>Object.hasOwn(record,key)&&typeof record[key]===typeof records[0][key]&&['number','string','boolean'].includes(typeof record[key])));
  for(const key of common){const values=records.map(record=>String(record[key])),numeric=records.every(record=>typeof record[key]==='number');fields.push({key:'parameters.'+key,label:({quantity:'Количество, шт',ip:'IP',power_watts:'Мощность, Вт',connectors:'Коннекторы',end_caps:'Заглушки'} as Record<string,string>)[key]??key.replace(/^custom:/,''),values,type:numeric?'decimal':records.every(record=>typeof record[key]==='boolean')?'select':'text',options:records.every(record=>typeof record[key]==='boolean')?[{value:'true',label:'Да'},{value:'false',label:'Нет'}]:undefined,min:key==='power_watts'?.001:0,max:key==='ip'?69:1e6,places:['quantity','ip','connectors','end_caps'].includes(key)?0:3});}
  if(kinds.every(kind=>isPowerSupply(kind)||isLedStrip(kind))&&!common.includes('power_watts'))fields.push({key:'parameters.power_watts',label:'Мощность, Вт',values:items.map(item=>String(item.parameters.power_watts??'')),type:'decimal',min:.001,max:1e6,places:3});
  if(kinds.every(kind=>kind?.unit==='м'))fields.push({key:'parameters.manual_length',label:'Длина вручную, м',values:items.map(item=>String(item.parameters.manual_length??item.parameters.length??'')),type:'decimal',min:0,max:1e6,places:3});
 }
 return fields;
}
export function nestedBulkPatch(values:Record<string,string>,numericKeys:Set<string>,nullableKeys:Set<string>=new Set(),booleanKeys:Set<string>=new Set()){
 const changes:Record<string,unknown>={},parameters:Record<string,unknown>={};
 for(const [key,value] of Object.entries(values)){
  const result=nullableKeys.has(key)&&!value?null:numericKeys.has(key)?Number(value.trim().replace(/[\s\u00a0\u202f]/g,'').replace(',','.')):key==='active'||booleanKeys.has(key)?value==='true':key==='currency'?value.toUpperCase():value;
  if(key.startsWith('parameters.'))parameters[key.slice(11)]=result;else changes[key]=result;
 }
 if(Object.keys(parameters).length)changes.parameters=parameters;return changes;
}
