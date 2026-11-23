import {useEffect,useRef,useState} from 'react';
import SearchSelect from './SearchSelect';
import DecimalInput from './DecimalInput';
import ImageField,{imageDragOver,imageDrop,imagePaste,prepareImage} from './ImageField';
import {ManufacturerField,type Maker} from './CatalogueFields';
import {errorMessage} from './errors';
import './ProductCard.css';
export type ProductCardDraft={name:string;typeId:string;manufacturer:string;sku:string;price:string;currency:string;image:string};
export default function ProductCardFields({value,onChange,types,makers,disabled=false,context,requiredType=false,typePlaceholder='Без номенклатуры',onBusyChange}:{value:ProductCardDraft;onChange:(patch:Partial<ProductCardDraft>)=>void;types:{id:number;name:string}[];makers:Maker[];disabled?:boolean;context:string;requiredType?:boolean;typePlaceholder?:string;onBusyChange?:(busy:boolean)=>void}){
 const [preparing,setPreparing]=useState(false),[imageBusy,setImageBusy]=useState(false),[error,setError]=useState(''),[imageGeneration,setImageGeneration]=useState(0),request=useRef(0);
 useEffect(()=>()=>{request.current++;},[]);
 useEffect(()=>{onBusyChange?.(preparing||imageBusy);return()=>onBusyChange?.(false);},[preparing,imageBusy,onBusyChange]);
 async function receive(file:File){if(disabled)return;const current=++request.current;setImageGeneration(value=>value+1);setPreparing(true);setError('');try{const image=await prepareImage(file);if(current===request.current)onChange({image});}catch(e){if(current===request.current)setError(errorMessage(e,'Не удалось добавить фотографию'));}finally{if(current===request.current)setPreparing(false);}}
 return <fieldset className="product-card-fields" disabled={disabled} data-image-target onDragOver={imageDragOver} onDrop={event=>imageDrop(event,file=>void receive(file))} onPasteCapture={event=>imagePaste(event,file=>void receive(file))}>
  <label>Название<input autoFocus aria-label={'Название нового товара '+context} required maxLength={500} value={value.name} onChange={event=>onChange({name:event.target.value})}/></label>
  <label>Номенклатура<SearchSelect aria-label={'Номенклатура нового товара '+context} required={requiredType} value={value.typeId} onChange={event=>onChange({typeId:event.target.value})}><option value="">{typePlaceholder}</option>{types.map(type=><option value={type.id} key={type.id}>{type.name}</option>)}</SearchSelect></label>
  <ManufacturerField label={'Производитель нового товара '+context} value={value.manufacturer} makers={makers} disabled={disabled} onChange={manufacturer=>onChange({manufacturer})}/>
  <label>Артикул<input aria-label={'Артикул нового товара '+context} maxLength={200} value={value.sku} onChange={event=>onChange({sku:event.target.value})}/></label>
  <label>Цена<DecimalInput aria-label={'Цена нового товара '+context} required min="0" max="1000000000" step=".01" value={value.price} onChange={event=>onChange({price:event.target.value})}/></label>
  <label>Валюта<input aria-label={'Валюта нового товара '+context} required pattern="[A-Z]{3}" maxLength={3} value={value.currency} onChange={event=>onChange({currency:event.target.value.toUpperCase()})}/></label>
  <ImageField key={imageGeneration} label={'Фото нового товара '+context} value={value.image} disabled={disabled||preparing} onChange={image=>onChange({image})} onBusyChange={setImageBusy}/>
  {preparing&&<p role="status">Подготовка фотографии…</p>}{error&&<p role="alert" className="catalog-error">{error}</p>}
 </fieldset>;
}
