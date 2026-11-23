import {useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {Catalog,Item,Kind,Product} from './App';
import SearchSelect from './SearchSelect';
import ProductCardFields,{type ProductCardDraft} from './ProductCardFields';
import {DuplicateProducts,duplicateProducts,type DuplicateProduct} from './CatalogueFields';
import {api,errorMessage} from './errors';
import {refreshCatalogue} from './catalogueStore';
import {decimalIssue} from './DecimalInput';
import './ProductCard.css';
type Creation={draft:ProductCardDraft;initial:string;ids:number[];typeId:number;existingId?:number};
export default function PlanProductAssignment({items,types,catalog,projectId,busy,locked,onBefore,onAssigned,onRefine,onError,onDirtyChange,onBusyChange}:{items:Item[];types:Kind[];catalog:Catalog;projectId:number;busy:boolean;locked:boolean;onBefore:()=>Promise<void>;onAssigned:()=>Promise<void>;onRefine:(ids:number[])=>void;onError:(message:string)=>void;onDirtyChange:(dirty:boolean)=>void;onBusyChange:(busy:boolean)=>void}){
 const [chosen,setChosen]=useState<string|null>(null),[saving,setSaving]=useState(false),[imageBusy,setImageBusy]=useState(false),[creation,setCreation]=useState<Creation|null>(null),[matches,setMatches]=useState<DuplicateProduct[]|null>(null),[error,setError]=useState('');
 const typeId=items[0]?.type_id,compatible=Boolean(items.length)&&items.every(item=>item.type_id===typeId),kind=types.find(type=>type.id===typeId);
 const key=items.map(item=>item.id+':'+item.type_id+':'+item.product_id).join('|'),previous=useRef(key);
 useEffect(()=>{if(previous.current!==key){previous.current=key;setChosen(null);setError('');}},[key]);
 const common=items.length&&items.every(item=>item.product_id===items[0].product_id)?items[0].product_id:null;
 const selectedId=chosen??common?.toString()??'',baseProduct=catalog.products.find(product=>product.id===Number(selectedId)),commercial=items.length===1?items[0].parameters._quotation as Record<string,string>|undefined:undefined,product=baseProduct?{...baseProduct,...commercial,...(commercial?.unit_price?{price:Number(commercial.unit_price)}:{}),name:items.length===1?String(items[0].parameters.display_name||baseProduct.name):baseProduct.name}:undefined;
 const choices=useMemo(()=>catalog.products.filter(product=>(product.type_id===typeId||product.type_id===null&&product.unit===kind?.unit)&&(product.active||product.id===common)).map(product=>({value:String(product.id),label:product.name+(product.sku?' · '+product.sku:''),group:product.manufacturer,disabled:!product.active,image:typeof product.parameters.image==='string'?product.parameters.image:undefined})),[catalog.products,typeId,common,kind?.unit]);
 const working=busy||saving||imageBusy,dirty=Boolean(creation&&JSON.stringify(creation.draft)!==creation.initial);
 useEffect(()=>{onDirtyChange(Boolean(creation));return()=>onDirtyChange(false);},[Boolean(creation),onDirtyChange]);
 useEffect(()=>{onBusyChange(saving||imageBusy);return()=>onBusyChange(false);},[saving,imageBusy,onBusyChange]);
 useEffect(()=>{if(!creation)return;const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload);},[Boolean(creation)]);
 function close(){if(working)return;if(dirty&&!confirm('Закрыть форму нового товара без сохранения?'))return;setCreation(null);setMatches(null);setError('');}
 function open(query=''){
  if(!compatible||locked||working)return;
  const draft:ProductCardDraft={name:query||'',manufacturer:'',typeId:String(typeId),sku:'',price:'0',currency:'RUB',image:''};
  setCreation({draft,initial:JSON.stringify(draft),ids:items.map(item=>item.id),typeId:typeId!});setError('');setMatches(null);
 }
 async function assign(id:number|null,ids=items.map(item=>item.id)){
  setSaving(true);setError('');try{await onBefore();await api(`/projects/${projectId}/elements/product`,'POST',{element_ids:ids,product_id:id});await onAssigned();setChosen(null);setCreation(null);setMatches(null);}
  catch(e){const message=errorMessage(e);setError(message);onError(message);}finally{setSaving(false);}
 }
 async function create(allowDuplicate=false,forceNew=false){
  if(!creation)return;setSaving(true);setError('');
  try{await onBefore();const draft=creation.draft;await api<{product:Product}>(`/projects/${projectId}/elements/product`,'POST',{element_ids:creation.ids,create:{name:draft.name,manufacturer:draft.manufacturer,sku:draft.sku,type_id:draft.typeId?Number(draft.typeId):null,unit_price:draft.price,currency:draft.currency,image:draft.image,existing_product_id:forceNew?null:creation.existingId??null,allow_duplicate:allowDuplicate}});await refreshCatalogue();await onAssigned();setCreation(null);setMatches(null);setChosen(null);}
  catch(e){const duplicates=duplicateProducts(e);if(duplicates)setMatches(duplicates);else{const message=errorMessage(e);setError(message);onError(message);}}finally{setSaving(false);}
 }
 const groups=[...new Set(items.map(item=>item.type_id))];
 return <>{items.length>0&&<div className="plan-product-assignment" aria-label="Назначение товара выбранным объектам">
  <h4>Товар для выбранных · {items.length}</h4>
  {compatible?<><label>Товар<SearchSelect aria-label={items.length===1?'Товар объекта':'Товар выбранных объектов'} value={selectedId} disabled={working||locked} dataOptions={[{value:'',label:common===null&&items.some(item=>item.product_id!==null)?'Разные товары / без привязки':'Без привязки к товару'},...choices]} onCreate={kind?.active?query=>open(query):undefined} onChange={event=>{const value=event.target.value;setChosen(value);if(items.length===1)void assign(value?Number(value):null);}}/></label>
    {product&&<div className="plan-product-preview">{typeof product.parameters.image==='string'&&product.parameters.image&&<img src={product.parameters.image} alt="Фотография выбранного товара"/>}<span><strong>{product.name}</strong><small>{product.manufacturer} · {product.sku||'Без артикула'}</small><small>{product.price.toLocaleString('ru-RU')} {product.currency} / {product.unit}</small>{commercial?.description&&<small>{commercial.description}</small>}</span></div>}
    {items.length>1&&<button type="button" className="primary" disabled={working||locked||(!selectedId&&chosen===null)||product?.active===false} onClick={()=>void assign(selectedId?Number(selectedId):null)}>{selectedId?'Применить товар ко всем':'Снять привязку у всех'} · {items.length}</button>}
    <button type="button" disabled={working||locked||!kind?.active} onClick={()=>open()}>＋ Добавить товар в базу с плана</button>
    {items.some(item=>item.product_id!==null)&&<button type="button" disabled={working||locked} onClick={()=>void assign(null)}>Снять привязку товара{items.length>1?' у выбранных':''}</button>}
   </>:<div className="warning"><strong>Выбраны разные объекты</strong><p>Для одного товара выберите объекты одной номенклатуры. Типы и единицы сохранятся.</p>{groups.map(id=><button key={id} type="button" disabled={working} onClick={()=>onRefine(items.filter(item=>item.type_id===id).map(item=>item.id))}>Выбрать: {types.find(type=>type.id===id)?.name||'Номенклатура'} · {items.filter(item=>item.type_id===id).length}</button>)}</div>}
   {saving&&<p role="status">Сохранение товара и привязок…</p>}{error&&!creation&&<p role="alert" className="catalog-error">{error}</p>}
  </div>}
   {creation&&createPortal(<PlanProductModal busy={working} onClose={close}>
     <h2>{creation.existingId?'Редактирование товара в общей базе':'Новый товар с плана'}</h2><p>Карточка и фотография сохранятся в общей базе. Товар будет назначен выбранным объектам: {creation.ids.length}. Фотография будет доступна в КП; цены ранее сохранённых КП сохранятся.</p>
     <form onSubmit={event=>{event.preventDefault();if(!working)void create();}}>
      <ProductCardFields context="с плана" value={creation.draft} types={types.filter(type=>type.id===creation.typeId&&type.active)} makers={catalog.manufacturers} disabled={busy||saving} onBusyChange={setImageBusy} onChange={patch=>{if(['name','sku','manufacturer','typeId'].some(key=>Object.hasOwn(patch,key)))setMatches(null);setCreation(current=>current?{...current,draft:{...current.draft,...patch}}:null);}}/>
      {error&&<p role="alert" className="catalog-error">{error}</p>}<div className="product-card-actions"><button type="button" disabled={working} onClick={close}>Отмена</button><button className="primary" disabled={working||Boolean(decimalIssue(creation.draft.price,0,1e9,2))}>{creation.existingId?'Сохранить и назначить выбранным':'Создать и назначить выбранным'} · {creation.ids.length}</button></div>
      {matches&&<><DuplicateProducts matches={matches} disabled={working} canEdit={item=>(item.type_id===null||item.type_id===creation.typeId)&&item.active} onEdit={id=>{const product=catalog.products.find(product=>product.id===id);if(product)setCreation(current=>current?{...current,existingId:product.id,draft:{...current.draft,typeId:product.type_id?String(product.type_id):'',name:product.name,sku:product.sku,manufacturer:product.manufacturer,price:String(product.price),currency:product.currency,image:String(product.parameters.image??'')}}:null);}} onSeparate={()=>void create(true,true)} onCancel={()=>setMatches(null)}/><p className="hint">Для использования существующей карточки выберите её ниже. Повторное добавление не требуется.</p>{matches.filter(item=>(item.type_id===null||item.type_id===creation.typeId)&&item.active).map(item=><button type="button" disabled={working} key={item.id} onClick={()=>void assign(item.id,creation.ids)}>Использовать существующий товар: {item.name}</button>)}</>}
     </form>
   </PlanProductModal>,document.body)}
 </>;
}

function PlanProductModal({busy,onClose,children}:{busy:boolean;onClose:()=>void;children:React.ReactNode}){
 const node=useRef<HTMLDivElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const frame=requestAnimationFrame(()=>node.current?.querySelector<HTMLElement>('input,select,button')?.focus());return()=>{cancelAnimationFrame(frame);if(previous?.isConnected)previous.focus();};},[]);
 useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!(event.target as HTMLElement)?.closest('[data-search-popup],[role="combobox"][aria-expanded="true"]')){event.preventDefault();event.stopImmediatePropagation();if(!busy)onClose();}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);},[busy,onClose]);
 return <div ref={node} className="modal-backdrop plan-product-modal" role="dialog" aria-modal="true" aria-label="Новый товар с плана" onKeyDown={event=>{if(event.key!=='Tab')return;const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[data-image-dropzone]')].filter(item=>item.getClientRects().length),first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}><section className="product-card-dialog">{children}</section></div>;
}
