import {useEffect,useMemo,useState} from 'react';
import type {Catalog,Item,Kind} from './App';
import SearchSelect from './SearchSelect';
import {api,errorMessage} from './errors';

type Props={projectId:number;item:Item;members:Item[];types:Kind[];catalog:Catalog;busy:boolean;locked:boolean;onBefore:()=>Promise<void>;onSaved:()=>Promise<void>;onDirtyChange:(value:boolean)=>void;onBusyChange:(value:boolean)=>void};
export default function FrameProductEditor({projectId,item,members,types,catalog,busy,locked,onBefore,onSaved,onDirtyChange,onBusyChange}:Props){
 const group=String(item.parameters.frame_group),posts=Number(item.parameters.frame_posts);
 const initialProduct=String(item.parameters.frame_product_id??''),initialColor=String(item.parameters.frame_color??'');
 const [productId,setProductId]=useState(initialProduct),[color,setColor]=useState(initialColor),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const dirty=productId!==initialProduct||color!==initialColor,working=busy||saving;
 useEffect(()=>{setProductId(initialProduct);setColor(initialColor);setError('');},[group,initialProduct,initialColor]);
 useEffect(()=>{onDirtyChange(dirty);return()=>onDirtyChange(false);},[dirty,onDirtyChange]);
 useEffect(()=>{if(!dirty)return;const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload);},[dirty]);
 useEffect(()=>{onBusyChange(saving);return()=>onBusyChange(false);},[saving,onBusyChange]);
 const choices=useMemo(()=>{const kinds=new Map(types.map(type=>[type.id,type]));return catalog.products.filter(product=>{
  const kind=product.type_id===null?undefined:kinds.get(product.type_id),required=product.parameters.frame_posts??kind?.defaults.frame_posts;
  return product.unit==='шт'&&(!kind||kind.category==='Рамки')&&(product.active||String(product.id)===initialProduct)&&(required===undefined||required===null||required===''||Number(required)===posts);
 }).map(product=>({value:String(product.id),label:product.name+(product.sku?' · '+product.sku:''),sku:product.sku,group:product.manufacturer,disabled:!product.active,image:typeof product.parameters.image==='string'?product.parameters.image:undefined}));},[catalog.products,types,posts,initialProduct]);
 const product=catalog.products.find(product=>String(product.id)===productId),complete=members.length===posts;
 async function save(){setSaving(true);setError('');try{await onBefore();await api(`/projects/${projectId}/frames/${encodeURIComponent(group)}`,'PATCH',{product_id:productId?Number(productId):null,color});await onSaved();}catch(e){setError(errorMessage(e,'Не удалось сохранить свойства рамки'));}finally{setSaving(false);}}
 return <section className="frame-product-editor" aria-label="Свойства рамки"><strong>Рамка · {posts} {posts===1?'пост':posts<5?'поста':'постов'}</strong>
  <p className="hint">Свойства всей рамки. Товары электроустановок внутри сохранятся.</p>
  {!complete&&<p role="alert">Рамка неполная. Назначьте её электроустановкам заново.</p>}
  <label>Товар рамки<SearchSelect aria-label="Товар рамки" value={productId} disabled={working||locked||!complete} searchPlaceholder="Название или артикул…" dataOptions={[{value:'',label:'Без товара — по цвету и постам'},...choices]} onChange={event=>setProductId(event.target.value)}/></label>
  {product&&<div className="frame-product-preview">{typeof product.parameters.image==='string'&&product.parameters.image&&<img src={product.parameters.image} alt=""/>}<div><strong>{product.name}</strong><p>{[product.manufacturer,product.sku].filter(Boolean).join(' · ')}</p></div></div>}
  {!productId&&<label>Цвет рамки<input aria-label="Цвет рамки" maxLength={100} placeholder="Например, белый или графит" value={color} disabled={working||locked||!complete} onChange={event=>setColor(event.target.value)}/></label>}
  <p className="hint">{productId?'В КП объединяется по выбранному товару.':'В КП объединяется по цвету и числу постов. При разбивке — отдельно в каждом помещении.'}</p>
  {error&&<p role="alert" className="catalog-error">{error}</p>}
  {dirty&&<div className="product-card-actions"><button type="button" disabled={working} onClick={()=>{setProductId(initialProduct);setColor(initialColor);setError('');}}>Отменить свойства рамки</button><button className="primary" type="button" disabled={working||locked||!complete} onClick={()=>void save()}>Сохранить рамку</button></div>}
 </section>;
}
