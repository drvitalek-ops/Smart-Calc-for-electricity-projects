import ProductCardFields from "./ProductCardFields";
import BulkEditor,{type BulkField} from "./BulkEditor";
import IssueBar,{type WorkIssue,type WorkIssueTarget} from "./IssueBar";
import {rebaseCatalogue} from './catalogueRebase';
import useCatalogue,{refreshCatalogue,type CatalogueSnapshot} from './catalogueStore';
import {ManufacturerField,DuplicateProducts,duplicateProducts,type DuplicateProduct} from './CatalogueFields';
import {StatusBadge} from "./ui/Controls";
import QuotePreflight from "./QuotePreflight";
import {quoteNumberIssues,type QuoteNumberIssue} from "./quotationValidation";
import {priceIdentity,priceConflicts,exportIssues,exportAlarm} from "./quotationPrices";
import DecimalInput,{decimalIssue,decimalValue} from "./DecimalInput";
import {api,apiFetch,errorMessage} from "./errors";
import {moveQuoteLine,QUOTE_LINE_DRAG} from "./quotationOrder";
import ImageField,{imagePaste,prepareImage,imageDrop,imageDragOver} from "./ImageField";
import SearchInput from "./SearchInput";
import {quotationColors,quotationColor,type QuoteStyle} from "./quotationTheme";
import QuotationPreview from "./QuotationPreview";
import ToolRail, {ActionIcon,ToolButton, type ToolItem} from "./ToolRail";
import SearchSelect,{matchesSearch,type SearchOption} from "./SearchSelect";
import usePreference from "./usePreference";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import "./QuotationEditor.css";

export type QuotationKind = { id:number; name:string; category:string; unit:string; active:boolean };
type Line = {
  id:string; source_key:string; source_signature?:string; source_ids:number[]; type_id:number|null; product_id:number|null;
  name:string; sku:string; manufacturer:string; ip?:string; room:string; description:string; comment?:string; quantity:string;
  quantity_override?:string|null; calculated_quantity?:string|null; overrides?:string[];
  unit:"шт"|"м"; unit_price:string; currency:string; discount:string|null; image:string;
};
type Prices = {lines:(Line & {total:string;base_total:string;discount_amount:string;effective_discount:string})[];
  totals:Record<string,{base:string;discount:string;total:string}>};
type Quote = {
  merged_line_ids?:Record<string,string>;
  style?:QuoteStyle;revision:number;plan_sync?:boolean|null;plan_snapshot_ids?:number[]|null;excluded_plan_ids?:number[];plan_frame_snapshot_keys?:string[]|null;excluded_frame_keys?:string[]; room_layout?:'combined'|'rooms'|'legacy'; number:string; date:string; title:string; seller:string; customer:string;
  contact:string; terms:string; global_discount:string; lines:Line[];
  city:string;phone:string;email:string;website:string;address:string;slogan:string;valid_days:number;
  tax_note:string;logo:string;benefits:{title:string;text:string}[];
  client:Prices;partner:Prices;
};
type Props = {
  projectName:string; rooms?:{name:string}[]; types:QuotationKind[]; onChanged:()=>Promise<void>; onBrowse?:()=>void;
  onDirtyChange:(dirty:boolean)=>void; onBusyChange:(busy:boolean)=>void;
} & ({projectId:number;quotationId?:never;onAttached?:never} | {quotationId:number;projectId?:never;onAttached:(projectId:number)=>Promise<void>});
type AttachmentProject={id:number;name:string;quote_revision:number};
type ImportCheck={line_id:string;page:number;source_total:string|null;issues:string[];verified:boolean;modified?:boolean};


const cash=(value:string|number)=>Number(value).toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2});
const amount=(value:string|number,code:string)=>cash(value)+" "+(({RUB:"₽",USD:"$",EUR:"€"} as Record<string,string>)[code] ?? code);
const newLine=():Line=>({id:crypto.randomUUID(),source_key:"",source_ids:[],type_id:null,product_id:null,
  name:"Новая позиция",sku:"",manufacturer:"",room:"",description:"",comment:"",quantity:"1",unit:"шт",unit_price:"0",currency:"RUB",discount:null,image:""});

function pricePayload(quote:Quote|null){return {global_discount:quote?.global_discount??'0',lines:quote?.lines.map(line=>({id:line.id,quantity:line.quantity,unit_price:line.unit_price,currency:line.currency,discount:line.discount}))??[]};}
function priceRequest(quote:Quote|null){const payload=pricePayload(quote);payload.lines.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);return JSON.stringify(payload);}
function numberError(quote:Quote|null){return quoteNumberIssues(quote).slice(0,50).map(issue=>issue.label+': '+issue.message).join('; ');}
type Calculated=Pick<Quote,'client'|'partner'>;

export default function QuotationEditor({projectId,quotationId,projectName,rooms=[],types,onChanged,onDirtyChange,onBusyChange,onBrowse,onAttached}:Props) {
  const [doc,setDoc]=useState<Quote|null>(null),[prices,setPrices]=useState<Calculated|null>(null);
  const catalogue=useCatalogue();
  const lastCatalogue=useRef<CatalogueSnapshot|null>(null),savedDocument=useRef<Quote|null>(null);
  const [productDuplicates,setProductDuplicates]=useState<DuplicateProduct[]|null>(null);
  const [busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[calculating,setCalculating]=useState(false);
  const [error,setError]=useState(""),[message,setMessage]=useState(""),[mode,setMode]=useState<"client"|"partner">("partner");
  const [quoteBulkDirty,setQuoteBulkDirty]=useState(false);
  const [quoteBulkIssues,setQuoteBulkIssues]=useState<WorkIssue[]>([]);
  const [selectedLineIds,setSelectedLineIds]=useState<ReadonlySet<string>>(new Set());
  useEffect(()=>setSelectedLineIds(new Set()),[projectId,quotationId]);
  const [linePage,setLinePage]=useState(0),[lineQuery,setLineQuery]=useState(''),[catalogLimit,setCatalogLimit]=useState(100);
  const [linePageSize,setLinePageSize]=usePreference<number>('quote-page-size',100,(value):value is number=>typeof value==='number'&&[25,50,100,200,500].includes(value));
  const [preview,setPreview]=useState(false),[quoteTool,setQuoteTool]=useState("positions"),[productSearch,setProductSearch]=useState("");
  function chooseQuoteTool(id:string){setQuoteTool(id);setPreview(id==="preview");}
  const [attachOpen,setAttachOpen]=useState(false),[attachProjects,setAttachProjects]=useState<AttachmentProject[]>([]),[attachTarget,setAttachTarget]=useState("");
  const [imported,setImported]=useState<{filename:string;lines:Line[];warnings:string[];checks?:ImportCheck[]}|null>(null);
  const [importPage,setImportPage]=useState(0);
  const [importMode,setImportMode]=useState<"append"|"replace">("append");
  const importInput=useRef<HTMLInputElement>(null);
  const [productImageBusy,setProductImageBusy]=useState(false);
  const [newProduct,setNewProduct]=useState<{lineId:string;name:string;manufacturer:string;sku:string;typeId:string;price:string;currency:string;image:string;existingId?:number}|null>(null);
  const previousProductCatalogue=useRef(catalogue);
  useEffect(()=>{
    const previous=previousProductCatalogue.current;previousProductCatalogue.current=catalogue;
    if(!newProduct?.existingId)return;
    const before=previous.products.find(item=>item.id===newProduct.existingId),after=catalogue.products.find(item=>item.id===newProduct.existingId);
    if(!before||!after)return;
    const fields=(product:typeof before)=>({...newProduct,name:product.name,sku:product.sku,manufacturer:product.manufacturer,typeId:product.type_id?String(product.type_id):'',price:String(product.price),currency:product.currency,image:typeof product.parameters.image==='string'?product.parameters.image:''});
    const old=fields(before),next=fields(after);
    try{productInitial.current=JSON.stringify(rebaseCatalogue(JSON.parse(productInitial.current),old,next));}catch{}
    setNewProduct(current=>current?.existingId===after.id?rebaseCatalogue(current,old,next):current);
  },[catalogue]);
  const [roomFilter,setRoomFilter]=useState<string|null>(null),[activeLineId,setActiveLineId]=useState<string|null>(null),[editingLineId,setEditingLineId]=useState<string|null>(null);
  const [expandedRows,setExpandedRows]=useState<ReadonlySet<string>>(new Set());
  const [draggedId,setDraggedId]=useState<string|null>(null),[dropTarget,setDropTarget]=useState<{id:string;after:boolean}|null>(null);
  const dragSource=useRef<string|null>(null),dragY=useRef<number|null>(null),tableWrap=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const wrap=tableWrap.current,head=wrap?.querySelector('thead');if(!wrap||!head)return;
    const measure=()=>wrap.style.setProperty('--quotation-table-head-height',head.getBoundingClientRect().height+'px');
    measure();const observer=new ResizeObserver(measure);observer.observe(head);return()=>observer.disconnect();
  },[quoteTool,preview,Boolean(doc)]);
  const normalizeRoom=(value:string)=>value.trim()==='Без помещения'?'':value.trim();
  const roomChoices=useMemo(()=>[...new Set([...(doc?.lines.map(line=>normalizeRoom(line.room))??[]),...rooms.map(room=>normalizeRoom(room.name))])].filter(Boolean),[doc?.lines,rooms]);
  const grouped=Boolean(doc?.lines.some(line=>normalizeRoom(line.room)));
  function expandRow(id:string,open=true){setExpandedRows(current=>{const next=new Set(current);if(open)next.add(id);else next.delete(id);return next;});}
  useEffect(()=>{
    if(!draggedId)return;
    let frame=0,last=0;
    const track=(event:DragEvent)=>{if(dragSource.current&&event.dataTransfer?.types.includes(QUOTE_LINE_DRAG)){event.preventDefault();event.dataTransfer.dropEffect='move';dragY.current=event.clientY;}};
    const scroll=(time:number)=>{
      const node=tableWrap.current,y=dragY.current,dt=Math.min(50,last?time-last:16)/1000;last=time;
      if(node&&y!==null){
        const outer=node.closest<HTMLElement>('.quotation-content'),rect=node.getBoundingClientRect(),outside=outer?.getBoundingClientRect(),dock=node.closest('.quotation-editor')?.querySelector('.quotation-dock')?.getBoundingClientRect();
        const top=Math.max(rect.top,outside?.top??rect.top)+(node.querySelector('thead')?.getBoundingClientRect().height??30),bottom=Math.min(rect.bottom,outside?.bottom??rect.bottom,dock?dock.top-8:Infinity),edge=Math.min(110,(bottom-top)/3);
        const distance=y<top+edge?y-top-edge:y>bottom-edge?y-bottom+edge:0;
        if(distance&&edge>0){
          const delta=Math.sign(distance)*(300+Math.min(1,Math.abs(distance)/edge)**1.5*1700)*dt;
          const before=node.scrollTop;node.scrollTop+=delta;
          if(node.scrollTop===before&&outer)outer.scrollTop+=delta;
        }
      }
      frame=requestAnimationFrame(scroll);
    };
    document.addEventListener('dragover',track,true);frame=requestAnimationFrame(scroll);
    return()=>{cancelAnimationFrame(frame);document.removeEventListener('dragover',track,true);};
  },[draggedId]);
  const productPickers=useMemo(()=>{
    const byUnit=new Map<string,SearchOption[]>(),byType=new Map<string,SearchOption[]>(),byId=new Map<number,SearchOption>();
    const add=(map:Map<string,SearchOption[]>,key:string,option:SearchOption)=>{const options=map.get(key)??[{value:'',label:'Без привязки к товару'}];options.push(option);map.set(key,options);};
    for(const product of catalogue.products){
      const option={value:String(product.id),label:product.name+(product.sku?' · '+product.sku:''),group:product.manufacturer,disabled:!product.active,image:typeof product.parameters.image==='string'?product.parameters.image:undefined};byId.set(product.id,option);
      if(product.active){add(byUnit,product.unit,option);add(byType,product.unit+':'+product.type_id,option);if(product.type_id===null)for(const type of types.filter(type=>type.unit===product.unit))add(byType,product.unit+':'+type.id,option);}
    }
    return {byUnit,byType,byId};
  },[catalogue.products]);
  const filteredLines=useMemo(()=>doc?.lines.flatMap((line,index)=>
    (line.id===editingLineId||(roomFilter===null||normalizeRoom(line.room)===roomFilter)&&(!lineQuery||matchesSearch([line.name,line.sku,line.manufacturer,line.room,line.comment].join(' '),lineQuery)))?[{line,index}]:[])??[],[doc?.lines,lineQuery,roomFilter,editingLineId]);
  const linePages=Math.max(1,Math.ceil(filteredLines.length/linePageSize)),activePage=Math.min(linePage,linePages-1),visibleLines=filteredLines.slice(activePage*linePageSize,(activePage+1)*linePageSize);
  const insertionAnchor=visibleLines.find(item=>item.line.id===activeLineId)??visibleLines.at(-1);
  const filteredProducts=useMemo(()=>catalogue.products.filter(product=>product.active&&matchesSearch([product.name,product.sku,product.manufacturer].join(' '),productSearch)),[catalogue.products,productSearch]);
  const docRef=useRef<Quote|null>(doc),dirtyRef=useRef(dirty);docRef.current=doc;dirtyRef.current=dirty;
  const bulkLines=useMemo(()=>doc?.lines.filter(line=>selectedLineIds.has(line.id))??[],[doc?.lines,selectedLineIds]);
  const bulkMixed=new Set(bulkLines.map(line=>types.find(type=>type.id===line.type_id)?.category??'Без категории')).size>1;
  const bulkFields=useMemo(()=>{
    const field=(key:keyof Line,label:string,extra:Partial<BulkField>={}):BulkField=>({key,label,values:bulkLines.map(line=>String(line[key]??'')),...extra});
    const fields=[field('manufacturer','Бренд',{maxLength:500}),field('room','Помещение',{maxLength:500}),field('comment','Комментарий'),field('ip','IP',{maxLength:16}),field('description','Описание'),field('unit_price','Цена',{type:'decimal'}),field('currency','Валюта',{maxLength:3}),field('discount','Скидка, %',{type:'decimal',max:100,allowEmpty:true})];
    if(bulkLines.length&&bulkLines.every(line=>line.unit===bulkLines[0].unit))fields.push(field('quantity','Количество, '+bulkLines[0].unit,{type:'decimal',min:.001,max:1e6,places:3}));
    return fields;
  },[bulkLines]);
  function toggleQuoteLine(id:string){setSelectedLineIds(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});}
  async function applyQuoteProperties(values:Record<string,string>){
    if(!docRef.current)return;setError('');
    if(values.currency!==undefined&&!/^[A-Z]{3}$/.test(values.currency.toUpperCase())){const message='Валюта должна состоять из трёх латинских букв';setError(message);throw Error(message);}
    const patch={...values,...(values.currency!==undefined?{currency:values.currency.toUpperCase()}:{}),...(values.discount===''?{discount:null}:{})} as Partial<Line>;
    const current=docRef.current,general=current.room_layout==='combined'||current.room_layout==='legacy'&&!current.lines.some(line=>normalizeRoom(line.room));
    const priceKeys=new Set(bulkLines.map(priceIdentity)),allowed=['name','sku','manufacturer','room','description','ip','unit_price','currency','image'];
    change(quote=>({...quote,lines:quote.lines.map(line=>{
      const changes=selectedLineIds.has(line.id)?patch:general&&Object.hasOwn(patch,'unit_price')&&priceKeys.has(priceIdentity(line))?{unit_price:patch.unit_price}:null;
      if(!changes)return line;
      return {...line,...changes,...(line.source_key&&Object.hasOwn(changes,'quantity')?{quantity_override:changes.quantity,calculated_quantity:line.calculated_quantity??line.quantity}:{}),overrides:line.source_key||line.product_id?[...new Set([...(line.overrides??[]),...Object.keys(changes).filter(key=>allowed.includes(key))])]:line.overrides};
    })}),true);setMessage('Изменены выбранные позиции: '+bulkLines.length+'. Ctrl+Z — отменить.');
  }
  const numericError=useMemo(()=>numberError(doc),[doc]),validationIssues=useMemo(()=>quoteNumberIssues(doc),[doc]);
  const errorSummary=useRef<HTMLDivElement>(null),focusError=useRef(false);
  const productInitial=useRef('');
  useEffect(()=>{if(!busy&&focusError.current){focusError.current=false;errorSummary.current?.focus();}},[busy,error]);
  const calculationBody=useMemo(()=>priceRequest(doc),[doc]),calculatedKey=useRef('');
  const history=useRef<Quote[]>([]),future=useRef<Quote[]>([]),lastChange=useRef(0);
  const standalone=quotationId!==undefined;
  const base=standalone ? "/quotations/"+quotationId : "/projects/"+projectId+"/quotation";
  function apply(value:Quote) {savedDocument.current=value;calculatedKey.current=priceRequest(value);setDoc(value);setPrices(value);setDirty(false);setCalculating(false);history.current=[];future.current=[];lastChange.current=0;}
  async function work(action:()=>Promise<void>) {
    setBusy(true);setError("");setMessage("");
    try {await action();} catch(error) {setError(errorMessage(error,"Ошибка"));}
    finally {setBusy(false);}
  }
  async function load() {
    const [value,products]=await Promise.all([api<Quote>(base),refreshCatalogue()]);
    apply(value);lastCatalogue.current=products;
  }
  useEffect(()=>{void work(load);},[base]);
  useEffect(()=>{onDirtyChange(dirty||quoteBulkDirty||Boolean(newProduct)||Boolean(imported));},[dirty,quoteBulkDirty,newProduct,imported,onDirtyChange]);
  useEffect(()=>{onBusyChange(busy||productImageBusy);},[busy,productImageBusy,onBusyChange]);
  useEffect(()=>()=>{onDirtyChange(false);onBusyChange(false);},[onDirtyChange,onBusyChange]);
  useEffect(()=>{
    const unload=(event:BeforeUnloadEvent)=>{if(dirty||quoteBulkDirty){event.preventDefault();event.returnValue="";}};
    window.addEventListener("beforeunload",unload);return()=>window.removeEventListener("beforeunload",unload);
  },[dirty,quoteBulkDirty]);
  useEffect(()=>{
    if(!doc || !dirty || calculatedKey.current===calculationBody){setCalculating(false);return;}
    const cancellation=new AbortController();
    setCalculating(true);
    const timer=window.setTimeout(()=>{
      if(numericError){setError(numericError);setCalculating(false);return;}
      api<Calculated>(base+"/calculate","POST",pricePayload(docRef.current),cancellation.signal)
        .then(value=>{if(!cancellation.signal.aborted){calculatedKey.current=calculationBody;setPrices(value);setCalculating(false);setError("");}})
        .catch(error=>{if(!cancellation.signal.aborted){setError(errorMessage(error,"Ошибка расчёта"));setCalculating(false);}});
    },350);
    return()=>{window.clearTimeout(timer);cancellation.abort();};
  },[calculationBody,dirty,base,numericError]);
  function change(update:(current:Quote)=>Quote,separate=false) {
    const current=docRef.current;
    if(!current || busy)return;
    const now=Date.now();
    if(separate || now-lastChange.current>600){history.current.push(current);if(history.current.length>30)history.current.shift();}
    lastChange.current=separate?0:now;future.current=[];const next=update(current);docRef.current=next;setDoc(next);setDirty(true);setMessage("");
  }
  function appendLine(line:Line){const count=docRef.current?.lines.length??0;if(count>=5000){setError("В КП не может быть больше 5000 строк");return;}change(quote=>({...quote,lines:[...quote.lines,line]}),true);setLineQuery('');setRoomFilter(null);setActiveLineId(line.id);setLinePage(Math.floor(count/linePageSize));chooseQuoteTool('positions');}
  function insertNearCurrent(){
    const current=docRef.current;if(!current||current.lines.length>=5000)return;
    const anchor=insertionAnchor?.line;
    const index=anchor?current.lines.findIndex(line=>line.id===anchor.id)+1:current.lines.length;
    const line={...newLine(),room:anchor?.room??roomFilter??''};
    change(quote=>({...quote,lines:[...quote.lines.slice(0,index),line,...quote.lines.slice(index)]}),true);
    setLineQuery('');setRoomFilter(null);setActiveLineId(line.id);setLinePage(Math.floor(index/linePageSize));chooseQuoteTool('positions');
    requestAnimationFrame(()=>document.querySelector<HTMLInputElement>(`[data-quote-line="${CSS.escape(line.id)}"] .quotation-name-input`)?.focus());
  }
  function moveLine(id:string,target:string,after=false){
    const current=docRef.current;if(!current)return;
    const next=moveQuoteLine(current.lines,id,target,after);if(next===current.lines)return;
    change(quote=>({...quote,lines:next}),true);setActiveLineId(id);setMessage('Позиция перемещена. Ctrl+Z — отменить.');
  }
  function moveToPosition(id:string){
    const current=docRef.current;if(!current)return;
    const answer=prompt('Номер позиции, на которую переместить строку (1–'+current.lines.length+')',String(current.lines.findIndex(line=>line.id===id)+1));if(answer===null)return;
    const number=Number(answer.trim());if(!Number.isInteger(number)||number<1||number>current.lines.length){setError('Введите целый номер от 1 до '+current.lines.length);return;}
    const index=current.lines.findIndex(line=>line.id===id);moveLine(id,current.lines[number-1].id,index<number-1);setLineQuery('');setRoomFilter(null);setLinePage(Math.floor((number-1)/linePageSize));requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(`[data-quote-line="${CSS.escape(id)}"] .quote-drag-handle`)?.focus());
  }
  function endDrag(){dragSource.current=null;dragY.current=null;setDraggedId(null);setDropTarget(null);}
  function rowDragOver(event:React.DragEvent<HTMLTableRowElement>,id:string){
    if(event.dataTransfer.types.includes('Files')){imageDragOver(event);return;}
    if(!dragSource.current||!event.dataTransfer.types.includes(QUOTE_LINE_DRAG))return;
    event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';dragY.current=event.clientY;
    const box=event.currentTarget.getBoundingClientRect(),after=event.clientY>box.top+box.height/2;
    setDropTarget(current=>current?.id===id&&current.after===after?current:{id,after});
  }
  function rowDrop(event:React.DragEvent<HTMLTableRowElement>,id:string){
    if(event.dataTransfer.types.includes('Files')){imageDrop(event,file=>void upload(file,image=>editLine(id,{image})));return;}
    if(!event.dataTransfer.types.includes(QUOTE_LINE_DRAG))return;
    event.preventDefault();event.stopPropagation();
    try{const payload=JSON.parse(event.dataTransfer.getData(QUOTE_LINE_DRAG));if(payload.base===base&&payload.id===dragSource.current){const rect=event.currentTarget.getBoundingClientRect();moveLine(payload.id,id,event.clientY>rect.top+rect.height/2);}}catch{}finally{endDrag();}
  }
  function groupLines(){
    change(current=>{const order=new Map<string,number>();for(const line of current.lines){const room=normalizeRoom(line.room);if(!order.has(room))order.set(room,order.size);}return {...current,lines:[...current.lines].sort((a,b)=>order.get(normalizeRoom(a.room))!-order.get(normalizeRoom(b.room))!)};},true);setLinePage(0);
  }
  function editLine(id:string,patch:Partial<Line>) {
    change(current=>{
      const source=current.lines.find(line=>line.id===id),key=source?priceIdentity(source):'';
      const general=current.room_layout==='combined'||current.room_layout==='legacy'&&!current.lines.some(line=>normalizeRoom(line.room));
      return {...current,lines:current.lines.map(line=>{
        const values=line.id===id?patch:general&&Object.hasOwn(patch,'unit_price')&&priceIdentity(line)===key?{unit_price:patch.unit_price}:null;
        if(!values)return line;
        const allowed=['name','sku','manufacturer','room','description','ip','unit_price','currency','image'];
        const overrides=line.source_key||line.product_id ? [...new Set([...(line.overrides??[]),...Object.keys(values).filter(key=>allowed.includes(key))])] : line.overrides;
        return {...line,...values,overrides};
      })};
    });
  }
  function undo(redo=false) {
    if(!doc || busy)return;
    const source=redo ? future.current : history.current,destination=redo ? history.current : future.current;
    const item=source.pop();if(!item)return;destination.push(doc);docRef.current=item;setDoc(item);setDirty(true);lastChange.current=0;
  }
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(newProduct || imported || attachOpen || (event.target as HTMLElement|null)?.closest('[role="dialog"]') || (event.target as HTMLElement|null)?.matches("input,textarea,select,[contenteditable=true]"))return;
      if((event.ctrlKey||event.metaKey)&&["z","я","y","н"].includes(event.key.toLowerCase())){
        event.preventDefault();undo(event.shiftKey||["y","н"].includes(event.key.toLowerCase()));
      }
    };
    window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);
  },[doc,busy,newProduct,imported,attachOpen]);
  useEffect(()=>{
    if(!doc||busy||lastCatalogue.current===catalogue)return;
    const controller=new AbortController();
    void api<Quote>(base,'GET',undefined,controller.signal).then(remote=>{
      const current=docRef.current,baseline=savedDocument.current;
      if(controller.signal.aborted||!current)return;
      lastCatalogue.current=catalogue;
      if(remote.revision<current.revision)return;
      if(remote.revision===current.revision&&JSON.stringify(remote)===JSON.stringify(baseline))return;
      if(!dirtyRef.current){apply(remote);return;}
      if(!baseline)return;
      // Only catalogue metadata may advance a dirty draft's revision. Other
      // concurrent edits must retain the normal save-conflict protection.
      const stableContent=({revision,client,partner,lines,...value}:Quote)=>({...value,lines:lines.map(({name,sku,manufacturer,image,description,ip,product_id,source_signature,...line})=>line)});
      if(JSON.stringify(stableContent(remote))!==JSON.stringify(stableContent(baseline)))return;
      const merge=(value:Quote):Quote=>({...value,revision:remote.revision,lines:value.lines.map(line=>{
        const old=baseline.lines.find(item=>item.id===line.id),next=remote.lines.find(item=>item.id===line.id);if(!old||!next)return line;
        const updated={...line};for(const key of ['name','sku','manufacturer','image','description','ip','product_id'] as const)if(line[key]===old[key])Object.assign(updated,{[key]:next[key]??(key==='product_id'?null:'')});return updated;
      })});
      const merged=merge(current);docRef.current=merged;setDoc(merged);savedDocument.current=remote;
      history.current=history.current.map(merge);future.current=future.current.map(merge);
    }).catch(error=>{if(!controller.signal.aborted)setError(errorMessage(error,'Не удалось обновить товары КП'));});
    return()=>controller.abort();
  },[catalogue,base,busy,Boolean(doc)]);
  function jumpToLine(id:string,index:number,field?:QuoteNumberIssue['field']){
    const actualIndex=docRef.current?.lines.findIndex(line=>line.id===id)??-1;
    if(actualIndex<0){setMessage('Эта позиция уже удалена из КП. Список сообщений обновлён.');return;}
    index=actualIndex;
    chooseQuoteTool('positions');setLineQuery('');setRoomFilter(null);setEditingLineId(null);setLinePage(Math.floor(index/linePageSize));setActiveLineId(id);
    if(!field)expandRow(id);
    requestAnimationFrame(()=>{const row=document.querySelector<HTMLElement>(`[data-quote-line="${CSS.escape(id)}"]`),prefix=field==='quantity'?'Количество строки ':field==='unit_price'?'Цена строки ':field==='discount'?'Скидка строки ':'';row?.scrollIntoView({block:'nearest'});const control=prefix?row?.querySelector<HTMLInputElement>(`[aria-label^="${prefix}"]`):row?.querySelector<HTMLInputElement>('.quotation-name-input');control?.scrollIntoView({block:'nearest',inline:'nearest'});control?.focus({preventScroll:true});});
  }
  function jumpToError(issue:QuoteNumberIssue){
    if(issue.id!==undefined&&issue.index!==undefined)jumpToLine(issue.id,issue.index,issue.field);
    else {chooseQuoteTool('positions');requestAnimationFrame(()=>{const input=document.querySelector<HTMLInputElement>('[aria-label="Общая скидка КП"]');input?.scrollIntoView({block:'nearest',inline:'nearest'});input?.focus({preventScroll:true});});}
  }
  function editCatalogueProduct(lineId:string,id:number){
    const product=catalogue.products.find(item=>item.id===id);if(!product)return;
    const draft={lineId,existingId:product.id,name:product.name,manufacturer:product.manufacturer,sku:product.sku,typeId:product.type_id?String(product.type_id):'',price:String(product.price),currency:product.currency,image:typeof product.parameters.image==='string'?product.parameters.image:''};
    productInitial.current=JSON.stringify(draft);setProductDuplicates(null);setError('');setNewProduct(draft);
  }
  async function deleteCatalogueProduct(id:number){
    if(!confirm('Удалить товар из общего выбора? Позиции и цены в сохранённых планах и КП останутся.'))return;
    await work(async()=>{await api('/products/'+id,'DELETE');await refreshCatalogue();setNewProduct(null);setProductDuplicates(null);await onChanged();setMessage('Товар удалён из общего выбора');});
  }
  async function saveProductFromQuote(allowDuplicate=false){
    if(!newProduct)return;
    await work(async()=>{
      const saved=await saveCurrent();let value:Quote;
      try{value=await api<Quote>(base+'/product','POST',{revision:saved.revision,line_id:saved.merged_line_ids?.[newProduct.lineId]??newProduct.lineId,type_id:newProduct.typeId?Number(newProduct.typeId):null,
        name:newProduct.name,manufacturer:newProduct.manufacturer,sku:newProduct.sku,unit_price:newProduct.price,currency:newProduct.currency,image:newProduct.image,
        existing_product_id:newProduct.existingId??null,allow_duplicate:allowDuplicate});}
      catch(error){const matches=duplicateProducts(error);if(matches){setProductDuplicates(matches);return;}throw error;}
      apply(value);setNewProduct(null);setProductDuplicates(null);await refreshCatalogue();await onChanged();setMessage(newProduct.existingId?'Товар обновлён в общей базе':'Товар создан в каталоге и привязан к позиции');
    });
  }
  function openNewProduct(line:Line){
    const draft={lineId:line.id,name:line.name,manufacturer:line.manufacturer,sku:line.sku,typeId:line.type_id?String(line.type_id):"",price:line.unit_price,currency:line.currency,image:line.image};
    productInitial.current=JSON.stringify(draft);setError('');setProductDuplicates(null);setNewProduct(draft);
  }
  function closeNewProduct(){
    if(busy)return;
    if(newProduct&&JSON.stringify(newProduct)!==productInitial.current&&!confirm('Закрыть форму нового товара без сохранения? Нажмите «Отмена», чтобы продолжить редактирование.'))return;
    setNewProduct(null);setError('');
  }
  async function saveCurrent():Promise<Quote> {
    if(!doc)throw Error("КП ещё не загружено");
    const issue=numberError(doc);if(issue){focusError.current=true;throw Error(issue);}
    if(!dirty)return doc;
    const saved=await api<Quote>(base,"PUT",{...doc,apply_to_plan:!standalone});apply(saved);if(!standalone)await onChanged();return saved;
  }
  async function setRoomLayout(layout:'combined'|'rooms'){
    if(standalone)return;
    await work(async()=>{const saved=await saveCurrent();apply(await api<Quote>(base+'/room-layout','POST',{revision:saved.revision,layout}));setRoomFilter(null);setLineQuery('');setLinePage(0);setMessage(layout==='rooms'?'Все связанные позиции распределены по помещениям плана, как в спецификации.':'Одинаковые позиции объединены в общее КП.');});
  }
  async function bind(lineId:string,productId:string) {
    await work(async()=>{
      const saved=await saveCurrent();
      const value=await api<Quote>(base+"/bind","POST",{revision:saved.revision,line_id:saved.merged_line_ids?.[lineId]??lineId,product_id:productId ? Number(productId) : null});
      apply(value);await onChanged();setMessage(standalone ? "Товар привязан к строке КП." : "Товар привязан. Позиции плана обновлены.");
    });
  }
  async function download(target:"client"|"partner") {
    await work(async()=>{
      let saved=await saveCurrent();
      if(!standalone){saved=await api<Quote>(base);apply(saved);}
      if(!saved.lines.length)throw Error("Добавьте позиции в КП");
      const alarm=exportAlarm(saved.lines);
      if(alarm&&!confirm(alarm)){setMessage("Формирование PDF отменено. Заполните отмеченные данные и повторите экспорт.");return;}
      const response=await apiFetch("/api"+base+"/export.pdf?mode="+target);
      const url=URL.createObjectURL(await response.blob()),link=document.createElement("a");
      link.href=url;link.download="КП-"+saved.number.replace(/[^a-zа-яё0-9_-]/gi,"-")+"-"+target+".pdf";
      link.click();window.setTimeout(()=>URL.revokeObjectURL(url),30000);
      setMessage(target==="client" ? "Клиентский PDF сформирован без скидок." : "Партнёрский PDF сформирован со скидками.");
    });
  }
  async function downloadSku(){
    await work(async()=>{
      const current=docRef.current;if(!current?.lines.length)throw Error('Добавьте позиции для выгрузки в Word');
      const issues=current.lines.flatMap((line,index)=>{const issue=decimalIssue(line.quantity,.001,1000000,3,true);return issue?['Строка КП № '+(index+1)+' — Количество: '+issue]:[];});
      if(issues.length){focusError.current=true;throw Error(issues.slice(0,50).join('; '));}
      const payload={number:current.number,room_layout:current.room_layout,plan_sync:current.plan_sync,plan_snapshot_ids:current.plan_snapshot_ids,excluded_plan_ids:current.excluded_plan_ids,plan_frame_snapshot_keys:current.plan_frame_snapshot_keys,excluded_frame_keys:current.excluded_frame_keys,lines:current.lines.map(({id,name,manufacturer,room,quantity,unit,type_id,source_key,source_signature,source_ids,quantity_override})=>({id,name,manufacturer,room,quantity,unit,type_id,source_key,source_signature,source_ids,quantity_override}))};
      const response=await apiFetch('/api'+base+'/sku.docx',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');
      link.href=url;link.download='SKU-КП-'+(current.number||'без-номера').replace(/[^a-zа-яё0-9_-]/gi,'-')+'.docx';
      link.click();window.setTimeout(()=>URL.revokeObjectURL(url),30000);setMessage('SKU сформирован в Word: наименования, бренды и количество без цен.');
    });
  }
  async function importFile(file:File|undefined) {
    if(!file)return;
    await work(async()=>{
      const form=new FormData();form.append("file",file);
      const response=await apiFetch("/api"+base+"/import-file",{method:"POST",body:form});
      const value=await response.json();
      setImported(value);setImportMode("append");setImportPage(0);
    });
  }
  function editImportedLine(id:string,patch:Partial<Line>) {
    setImported(current=>current ? {...current,lines:current.lines.map(line=>line.id===id ? {...line,...patch} : line),
      checks:current.checks?.map(check=>check.line_id===id ? {...check,modified:true} : check)} : null);
  }
  async function upload(file:File|undefined,done:(value:string)=>void,logo=false) {
    if(!file)return;
    try {done(await prepareImage(file,logo));}catch(error){setError(errorMessage(error,"Ошибка изображения"));}
  }
  if(!doc)return <section className="quotation-editor"><h2>Редактор КП</h2>{busy ? <p role="status">Загрузка КП…</p> : <><p role="alert">{error}</p><button onClick={()=>void work(load)}>Повторить загрузку КП</button></>}</section>;
  const calculated=prices ?? doc;
  const visiblePrices=calculated[mode];
  const rowPrices=new Map(visiblePrices.lines.map(line=>[line.id,line]));
  const issues=exportIssues(doc.lines),conflicts=priceConflicts(doc.lines);
  const lineIndices=new Map(doc.lines.map((line,index)=>[line.id,index])),kindCategories=new Map(types.map(type=>[type.id,type.category]));
  const positionTarget=(line:Line,field?:QuoteNumberIssue['field']):WorkIssueTarget=>({id:line.id,label:'№ '+((lineIndices.get(line.id)??0)+1)+' · '+line.name,
    detail:[kindCategories.get(line.type_id??0)??'Без категории',line.unit,line.room||'Без помещения',line.sku,field==='unit_price'?'Цена: '+line.unit_price.replace('.',',')+' '+line.currency:''].filter(Boolean).join(' · '),
    action:()=>jumpToLine(line.id,lineIndices.get(line.id)??0,field)});
  const bulkNotices:WorkIssue[]=validationIssues.map((issue,index)=>({id:'number'+index,group:'Числовые поля',title:issue.label+(issue.id?' · '+(doc.lines[issue.index??-1]?.name??''):''),detail:issue.message,severity:'error',action:()=>jumpToError(issue),actionLabel:'Перейти к полю'}));
  bulkNotices.push(...quoteBulkIssues);
  if(error)bulkNotices.unshift({id:'runtime',group:'Ошибка',title:'Не удалось завершить действие',detail:error,severity:'error'});
  if(bulkMixed){
    const categories=[...new Set(bulkLines.map(line=>kindCategories.get(line.type_id??0)??'Без категории'))],units=[...new Set(bulkLines.map(line=>line.unit))];
    bulkNotices.unshift({id:'mixed',group:'Выбраны разные объекты',title:'Смешанное выделение позиций КП',
      detail:'Это уведомление о выделении, а не ошибка в позициях. Выбрано позиций: '+bulkLines.length+'. Категории: '+categories.slice(0,8).join(', ')+(categories.length>8?' и ещё '+(categories.length-8):'')+'. Массовая правка меняет только отмеченные общие свойства. Номенклатура и единица каждой строки сохранятся. '+(units.length===1?'Единица у всех выбранных позиций — «'+units[0]+'», поэтому количество можно изменить совместно.':'Выбраны разные единицы: '+units.join(', ')+'. Для общей правки количества выделите только строки с одной единицей.'),
      severity:'info',targets:bulkLines.map(line=>positionTarget(line))});
  }
  if(conflicts.length){
    const keys=new Set(conflicts.map(priceIdentity));
    bulkNotices.push({id:'prices',group:'Разные цены',title:'Есть одинаковые позиции с разными ценами',detail:'Для одинакового товара найдены разные цены, поэтому нулевая цена не подставлена автоматически. Откройте связанные строки и проверьте условия. Изменение цены в общем КП применяется ко всем его одинаковым позициям.',severity:'warning',targets:doc.lines.filter(line=>keys.has(priceIdentity(line))).map(line=>positionTarget(line,'unit_price'))});
  }


  const productOptions=(line:Line)=>{
    const options=(line.source_ids.length&&line.type_id!==null?productPickers.byType.get(line.unit+':'+line.type_id):productPickers.byUnit.get(line.unit))??[{value:'',label:'Без привязки к товару'}];
    const selected=line.product_id?productPickers.byId.get(line.product_id):null;
    return selected?.disabled?[...options,selected]:options;
  };
  const tools:ToolItem[]=[
    {id:'positions',label:'Позиции',icon:'list',actionLabel:'Редактировать'},
    {id:'details',label:'Реквизиты и условия',icon:'edit'},
    {id:'brand',label:'Оформление КП',icon:'palette'},
    {id:'catalog',label:'Товары',icon:'catalog'},
    {id:'preview',label:'Предпросмотр',icon:'eye',actionLabel:'Предпросмотр'},
    {id:'save',label:'Сохранить',icon:'save',actionLabel:'Сохранить КП',disabled:busy||!dirty,command:()=>void work(async()=>{await saveCurrent();setMessage('КП сохранено');})},
    {id:'load',label:'Загрузить сохранённое',icon:'refresh',actionLabel:'Загрузить сохранённое КП',disabled:busy,command:()=>void work(async()=>{if(dirty&&!confirm('Отменить несохранённые правки и загрузить сохранённое КП?'))return;await load();})},
    {id:'import',label:'Импорт из файла',icon:'import',actionLabel:'Импорт из PDF / Excel / Word',disabled:busy,command:()=>importInput.current?.click()},
    {id:'sync',label:'Обновить из расчёта',icon:'refresh',actionLabel:'Обновить из расчёта',disabled:busy||standalone,command:()=>void work(async()=>{if(doc.lines.length&&!confirm('Обновить позиции из расчёта? Ручные правки, количество и скидки сохранятся. Удалённые на плане позиции уйдут из КП.'))return;const saved=await saveCurrent();apply(await api<Quote>(base+'/import','POST',{revision:saved.revision}));setMessage('Позиции обновлены из расчёта');})},
    {id:'rooms',label:'Распределить по помещениям',icon:'room',actionLabel:'Распределить по помещениям',disabled:busy||standalone,command:()=>void setRoomLayout('rooms')},
    {id:'sku',label:'Сделать SKU',icon:'sku',actionLabel:'Сделать SKU — Word без цен',disabled:busy||!doc.lines.length,command:()=>void downloadSku()},
    {id:'client',label:'PDF клиенту',icon:'pdf',actionLabel:'PDF для клиента — без скидок',disabled:busy||!doc.lines.length,command:()=>void download('client')},
    {id:'partner',label:'PDF партнёру',icon:'pdf',actionLabel:'PDF для партнёра — со скидками',disabled:busy||!doc.lines.length,command:()=>void download('partner')},
    ...(standalone?[{id:'attach',label:'Прикрепить к проекту',icon:'link',actionLabel:'Прикрепить к проекту',disabled:busy,command:()=>void work(async()=>{setAttachProjects(await api<AttachmentProject[]>("/quotations/project-options"));setAttachTarget("");setAttachOpen(true);})}]:[]),
    ...(onBrowse?[{id:'browse',label:'К списку КП',icon:'back',actionLabel:'К списку КП',disabled:busy,command:onBrowse}]:[]),
  ];
  return <section className="quotation-editor quote-workspace" aria-label="Редактор коммерческого предложения">
    <ToolRail label="Инструменты коммерческого предложения" active={quoteTool} onSelect={chooseQuoteTool} items={tools}/>
    <div className="quotation-content" data-tool={quoteTool}>
    <div className="quotation-heading"><div><div className="eyebrow">КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ</div><h2><span className="quote-document-icon" aria-hidden="true"><ActionIcon name="pdf"/></span>КП № {doc.number}</h2><p>{projectName} · {tools.find(tool=>tool.id===quoteTool)?.label}</p><div className="quotation-status" role="status"><StatusBadge tone={busy?"info":dirty?"warning":"success"}>{busy ? "Сохранение…" : dirty ? "Есть несохранённые изменения" : "КП сохранено"}{calculating ? " · Пересчёт итогов…" : ""}</StatusBadge></div></div><div className="quotation-client-fields" role="group" aria-label="Данные клиента КП">
      <label>Имя клиента<input aria-label="Клиент КП" maxLength={2000} disabled={busy} value={doc.customer} onChange={e=>change(q=>({...q,customer:e.target.value}))}/></label>
      <label>Контакт клиента<input aria-label="Контакт клиента КП" maxLength={2000} disabled={busy} value={doc.contact} onChange={e=>change(q=>({...q,contact:e.target.value}))}/></label>
    </div><div className="quotation-switch">
      <label>Цены<SearchSelect aria-label="Цены предпросмотра КП" value={mode} onChange={event=>setMode(event.target.value as "client"|"partner")}><option value="partner">Партнёр — со скидками</option><option value="client">Клиент — без скидок</option></SearchSelect></label>
    <details className="quotation-help"><summary>Справка по КП</summary><div><p>Количество связанных позиций обновляется из плана при открытии, сохранении и экспорте. «Вручную» сохраняет заданное вами количество.</p><p>Пустая скидка строки использует общую. Индивидуальная скидка, включая 0%, заменяет общую. В клиентском PDF скидки отключены.</p><p>Ctrl+Z — отмена правки. Ctrl+↑/↓ на маркере строки — перемещение позиции.</p></div></details>
    </div></div>

    <input ref={importInput} hidden type="file" aria-label="Файл внешнего КП" accept=".pdf,.xlsx,.xls,.xlsm,.docx,.csv" disabled={busy} onChange={event=>{void importFile(event.target.files?.[0]);event.target.value='';}}/>
    {!newProduct&&!imported&&!attachOpen&&error&&<div className="quote-error-summary catalog-error" role="alert" tabIndex={-1} ref={errorSummary}><strong>Не удалось завершить действие</strong>{validationIssues.length?<ul>{validationIssues.map(issue=><li key={(issue.id??'global')+issue.field}><button type="button" onClick={()=>jumpToError(issue)}>{issue.label}: {issue.message}</button></li>)}</ul>:<p>{error}</p>}</div>}
    {message && <p className="catalog-success" role="status">{message}</p>}
    {conflicts.length>0&&<p className="warning" role="alert">Для {conflicts.length} позиций найдены разные цены одинакового товара. Укажите нужную цену в общем КП — она применится ко всем его одинаковым позициям.</p>}

    <div className="quote-overview">
    <div className="quotation-totals">
      {(["client","partner"] as const).map(target=><article key={target} title={(target==="client"?"Без скидок":"Со скидками")+Object.entries(calculated[target].totals).map(([code,total])=>" · Скидка: "+amount(total.discount,code)).join("")}><small>{target==="client" ? "Клиент" : "Партнёр"}</small>
        {!numericError&&Object.entries(calculated[target].totals).map(([code,total])=><strong key={code}>{amount(total.total,code)}</strong>)}
        {numericError&&<span className="quote-number-warning">Проверьте числовые поля КП</span>}{!numericError&&!Object.keys(calculated[target].totals).length && <strong>0,00 ₽</strong>}
        {!numericError&&target==="partner" && Object.entries(calculated.partner.totals).map(([code,total])=><span className="quote-discount-summary" key={code}>Скидка: {amount(total.discount,code)}</span>)}
      </article>)}
    </div>
    <QuotePreflight issues={issues} onSelect={item=>jumpToLine(item.id,item.index)}/>
    <IssueBar label="Проверка КП" issues={bulkNotices}/>
    </div>

    {!preview ? <>
      <fieldset disabled={busy} className="quotation-fields">
        <label>Номер КП<input aria-label="Номер КП" maxLength={100} value={doc.number} onChange={e=>change(q=>({...q,number:e.target.value}))}/></label>
        <label>Дата<input aria-label="Дата КП" type="date" value={doc.date} onChange={e=>change(q=>({...q,date:e.target.value}))}/></label>
        <label>Срок действия, дней<input aria-label="Срок действия КП" type="number" min="1" max="365" value={doc.valid_days} onChange={e=>change(q=>({...q,valid_days:Number(e.target.value)}))}/></label>
      </fieldset>



      {quoteTool==='positions'&&<div className="quotation-position-tools"><label className="quotation-line-search">Поиск в позициях<input type="search" aria-label="Поиск позиций КП" placeholder="Название, артикул, бренд, помещение, комментарий…" value={lineQuery} onChange={event=>{setLineQuery(event.target.value);setLinePage(0);}}/></label>
        <label className="quotation-group-filter">Группа / помещение<SearchSelect aria-label="Группа позиций КП" value={roomFilter===null?'all':roomFilter===''?'none':'group:'+roomFilter} onChange={event=>{setEditingLineId(null);const value=event.target.value;setRoomFilter(value==='all'?null:value==='none'?'':value.slice(6));setLinePage(0);}}><option value="all">Все помещения</option><option value="none">Без помещения</option>{roomChoices.map(room=><option value={'group:'+room} key={room}>{room}</option>)}</SearchSelect></label>
        <ToolButton icon="layers" disabled={busy||!grouped} onClick={groupLines}>Сгруппировать</ToolButton>
        {quoteTool==='positions'&&!standalone&&<div className="quotation-room-actions"><ToolButton icon="room" disabled={busy} onClick={()=>void setRoomLayout('rooms')}>Распределить по помещениям</ToolButton>{doc.room_layout!=='combined'&&<ToolButton icon="layers" disabled={busy} onClick={()=>void setRoomLayout('combined')}>Объединить помещения</ToolButton>}<small>{doc.room_layout==='combined'?'Общее КП':doc.room_layout==='rooms'?'По помещениям плана':'Сохранённая разбивка по помещениям'}</small></div>}
        <label>Строк на странице<SearchSelect aria-label="Строк на странице КП" value={linePageSize} onChange={event=>{setLinePageSize(Number(event.target.value));setLinePage(0);}}>{[25,50,100,200,500].map(size=><option key={size} value={size}>{size}</option>)}</SearchSelect></label>
      </div>}
      {quoteTool==='positions'&&<>{bulkLines.length>0&&<div className="bulk-selection-tools"><span className="bulk-selection-count">Выбрано: {bulkLines.length}</span>{bulkLines.length>0&&<button type="button" onClick={()=>setSelectedLineIds(new Set())}>Снять выделение позиций КП</button>}</div>}{bulkLines.length>0&&<BulkEditor key={base} count={bulkLines.length} fields={bulkFields} mixed={bulkMixed} busy={busy} onApply={applyQuoteProperties} onIssuesChange={setQuoteBulkIssues} onDirtyChange={setQuoteBulkDirty}/>}</>}
      {quoteTool==='positions'&&<div className="quotation-positions-body">
      <div ref={tableWrap} className="quotation-table-wrap"><table className="quotation-table"><thead><tr><th><label className="quote-select-all" title={"Выбрать все найденные позиции · "+filteredLines.length}><input type="checkbox" aria-label="Выбрать все найденные позиции КП" checked={Boolean(filteredLines.length)&&filteredLines.every(({line})=>selectedLineIds.has(line.id))} disabled={busy} onChange={event=>{const checked=event.target.checked;setSelectedLineIds(current=>{const next=new Set(current);for(const {line} of filteredLines)if(checked)next.add(line.id);else next.delete(line.id);return next;});}}/>Позиция / товар</label></th><th>Кол-во</th><th>Ед.</th><th>Цена</th><th>Валюта</th><th className="quotation-discount-heading"><label className="quotation-global-discount" title="Применяется к строкам без индивидуальной скидки. В PDF для клиента скидки отключены."><span className="quotation-discount-label">Скидка, %<small>Общая</small></span><DecimalInput aria-label="Общая скидка КП" disabled={busy} min="0" max="100" step=".01" value={doc.global_discount} onChange={e=>change(q=>({...q,global_discount:e.target.value}))}/></label></th><th>Сумма</th><th></th></tr></thead>
        <tbody>{visibleLines.map(({line,index},visibleIndex)=>{
          const group=normalizeRoom(line.room),showGroup=grouped&&(visibleIndex===0||normalizeRoom(visibleLines[visibleIndex-1].line.room)!==group);
          return <Fragment key={line.id}>{showGroup&&<tr data-quote-group={group}><th colSpan={8}><span>{group||'Без помещения'}</span></th></tr>}
        <tr data-quote-line={line.id} data-bulk-selected={selectedLineIds.has(line.id)} className={(activeLineId===line.id?'quote-row-active ':'')+(draggedId===line.id?'quote-row-dragging ':'')+(dropTarget?.id===line.id?(dropTarget.after?'quote-drop-after':'quote-drop-before'):'')}
          onFocusCapture={()=>{setActiveLineId(line.id);setEditingLineId(line.id);}} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setEditingLineId(null);}} data-image-target onDragOver={event=>rowDragOver(event,line.id)} onDrop={event=>rowDrop(event,line.id)} onPasteCapture={event=>imagePaste(event,file=>void upload(file,image=>editLine(line.id,{image})))}>
          <td><div className="quotation-line-name"><input className="quote-row-check" type="checkbox" aria-label={"Выбрать строку КП "+(index+1)} disabled={busy} checked={selectedLineIds.has(line.id)} onChange={()=>toggleQuoteLine(line.id)}/><button type="button" className="quote-drag-handle" draggable={!busy} disabled={busy} aria-label={'Перетащить строку '+(index+1)} title="Перетащите для перемещения. Ctrl+↑ / Ctrl+↓ — на одну позицию."
            onDragStart={event=>{if(busy){event.preventDefault();return;}event.stopPropagation();dragSource.current=line.id;dragY.current=event.clientY;setDraggedId(line.id);setActiveLineId(line.id);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData(QUOTE_LINE_DRAG,JSON.stringify({base,id:line.id}));}}
            onDragEnd={endDrag} onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const target=doc.lines[index+(event.key==='ArrowUp'?-1:1)];if(target){moveLine(line.id,target.id,event.key==='ArrowDown');setLinePage(Math.floor((index+(event.key==='ArrowUp'?-1:1))/linePageSize));requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(`[data-quote-line="${CSS.escape(line.id)}"] .quote-drag-handle`)?.focus());}}}}><ActionIcon name="grip"/><small>{index+1}</small></button>
            {line.image&&<img src={line.image} alt=""/>}<div><input className="quotation-name-input" title={[line.name,line.sku].filter(Boolean).join(" · ")} aria-label={"Наименование строки "+(index+1)} value={line.name} disabled={busy} onChange={e=>editLine(line.id,{name:e.target.value})}/></div></div>
            <div className="quotation-row-meta"><input aria-label={"Артикул строки "+(index+1)} placeholder="Артикул" maxLength={200} title={line.sku||''} value={line.sku} disabled={busy} onChange={event=>editLine(line.id,{sku:event.target.value})}/>
              <SearchInput aria-label={"Бренд строки "+(index+1)} placeholder="Бренд" maxLength={500} title={line.manufacturer||''} options={catalogue.manufacturers.filter(item=>item.active!==false).map(item=>item.name)} value={line.manufacturer} disabled={busy} onChange={manufacturer=>editLine(line.id,{manufacturer})}/></div>
            <details className="quotation-row-details" open={expandedRows.has(line.id)} onToggle={event=>{const open=event.currentTarget.open;if(open!==expandedRows.has(line.id))expandRow(line.id,open);}}><summary aria-label={"Свойства строки "+(index+1)} title="Товар, фото и свойства">Товар, фото и свойства{line.sku?' · '+line.sku:''}{line.source_ids.length?' · На плане: '+line.source_ids.length:''}</summary>
            {expandedRows.has(line.id)&&<>
            <SearchSelect aria-label={"Товар строки "+(index+1)} value={line.product_id??''} disabled={busy} dataOptions={productOptions(line)} onChange={event=>void bind(line.id,event.target.value)}/>
            <div className="quotation-inline-actions">{line.product_id&&<><ToolButton icon="edit" disabled={busy} onClick={()=>editCatalogueProduct(line.id,line.product_id!)}>Редактировать товар в базе</ToolButton><ToolButton icon="trash" disabled={busy} onClick={()=>void deleteCatalogueProduct(line.product_id!)}>Удалить товар из базы</ToolButton></>}<button type="button" disabled={busy} onClick={()=>openNewProduct(line)}>＋ Товар в базу</button>
              <ImageField label={"Фото строки "+(index+1)} value={line.image} disabled={busy} onChange={image=>editLine(line.id,{image})}/>
            </div>
            <div className="quotation-row-context"><label>Помещение<SearchInput aria-label={"Помещение строки "+(index+1)} placeholder="Без помещения" maxLength={500} options={roomChoices} value={group} disabled={busy} onChange={room=>editLine(line.id,{room})}/></label>
              <label>Комментарий<textarea className="quotation-row-comment" aria-label={"Комментарий строки "+(index+1)} placeholder="Комментарий" rows={2} maxLength={2000} value={line.comment??''} disabled={busy} onChange={event=>editLine(line.id,{comment:event.target.value})}/></label></div>
            <label>IP<input aria-label={"IP строки "+(index+1)} placeholder="IP44" maxLength={16} value={line.ip??''} disabled={busy} onChange={event=>editLine(line.id,{ip:event.target.value})}/></label>
            <label>Номенклатура<SearchSelect aria-label={"Номенклатура строки "+(index+1)} disabled={busy||Boolean(line.source_ids.length)} value={line.type_id??''} onChange={event=>{const type=types.find(type=>type.id===Number(event.target.value));editLine(line.id,{type_id:type?.id??null,product_id:null});}}><option value="">Без категории</option>{types.filter(type=>type.active&&type.unit===line.unit).map(type=><option key={type.id} value={type.id}>{type.category} · {type.name}</option>)}</SearchSelect></label>
            <ToolButton icon="copy" type="button" disabled={busy} aria-label={"Дублировать строку "+(index+1)+" в КП"} onClick={()=>appendLine({...line,id:crypto.randomUUID(),source_key:'',source_ids:[],quantity_override:null,calculated_quantity:null,overrides:[]})}>Ручная копия строки</ToolButton>
            <ToolButton icon="list" type="button" disabled={busy} aria-label={'Переместить строку '+(index+1)+' на номер'} onClick={()=>moveToPosition(line.id)}>Переместить на №…</ToolButton>
            <textarea aria-label={"Описание строки "+(index+1)} placeholder="Описание товара" value={line.description} disabled={busy} onChange={e=>editLine(line.id,{description:e.target.value})}/>
            </>}</details>
          </td>
          <td><DecimalInput aria-label={"Количество строки "+(index+1)}  min=".001" max="1000000" step=".001" value={line.quantity} disabled={busy || (Boolean(line.source_key)&&line.quantity_override==null)} onChange={e=>editLine(line.id,{quantity:e.target.value,...(line.source_key?{quantity_override:e.target.value}:{})})}/>{line.source_key&&<><label className="manual-quantity"><input type="checkbox" aria-label={"Ручное количество строки "+(index+1)} checked={line.quantity_override!=null} onChange={event=>editLine(line.id,event.target.checked?{calculated_quantity:line.calculated_quantity??line.quantity,quantity_override:line.quantity}:{quantity_override:null,quantity:line.calculated_quantity??line.quantity})}/>{standalone?"Вручную":"Изменить на плане"}</label><small>По плану: {line.calculated_quantity??line.quantity}</small></>}</td>
          <td><SearchSelect aria-label={"Единица строки "+(index+1)} value={line.unit} disabled={busy || Boolean(line.source_key) || Boolean(line.product_id)} onChange={e=>editLine(line.id,{unit:e.target.value as "шт"|"м"})}><option value="шт">шт</option><option value="м">м</option></SearchSelect></td>
          <td><DecimalInput aria-label={"Цена строки "+(index+1)}  min="0" max="1000000000" step=".01" value={line.unit_price} disabled={busy} onChange={e=>editLine(line.id,{unit_price:e.target.value})}/></td>
          <td><input aria-label={"Валюта строки "+(index+1)} maxLength={3} value={line.currency} disabled={busy} onChange={e=>editLine(line.id,{currency:e.target.value.toUpperCase()})}/></td>
          <td><DecimalInput required={false} aria-label={"Скидка строки "+(index+1)}  min="0" max="100" step=".01" placeholder="Общая" value={line.discount ?? ""} disabled={busy} onChange={e=>editLine(line.id,{discount:e.target.value==="" ? null : e.target.value})}/><small>{line.discount===null ? "По общей" : "Индивидуальная"}</small></td>
          <td className="quotation-row-total">{calculating ? "…" : numericError ? "—" : rowPrices.has(line.id) ? amount(rowPrices.get(line.id)!.total,line.currency) : "—"}</td>
          <td><button aria-label={"Удалить строку "+(index+1)+" из КП"} title="Убрать только из КП" disabled={busy} onClick={()=>change(q=>({...q,lines:q.lines.filter(item=>item.id!==line.id)}),true)}><ActionIcon name="trash"/></button></td>
        </tr></Fragment>;})}</tbody></table></div>
      <div className="quotation-pagination" aria-label="Страницы позиций КП"><span>{filteredLines.length?activePage*linePageSize+1:0}–{Math.min((activePage+1)*linePageSize,filteredLines.length)} из {filteredLines.length}{lineQuery?' · всего '+doc.lines.length:''}</span><button type="button" disabled={activePage<=0} onClick={()=>setLinePage(activePage-1)}>Назад</button><span>Страница {activePage+1} из {linePages}</span><button type="button" disabled={activePage>=linePages-1} onClick={()=>setLinePage(activePage+1)}>Далее</button></div>
      {!filteredLines.length&&doc.lines.length>0&&<p className="hint">Подходящих позиций нет. Измените поиск.</p>}
      </div>}
      {!doc.lines.length && <p className="hint">Пока нет позиций. Добавьте строку вручную или импортируйте расчёт проекта.</p>}

      {quoteTool==='catalog'&&<section className="quote-catalog-panel" aria-label="Товары для КП"><h3>Добавить товар из базы</h3><input aria-label="Поиск товаров для КП" type="search" placeholder="Название, артикул, производитель…" value={productSearch} onChange={event=>{setProductSearch(event.target.value);setCatalogLimit(100);}}/>
        <div className="quote-catalog-products">{filteredProducts.slice(0,catalogLimit).map(product=><article key={product.id}><strong>{product.name}</strong><small>{product.manufacturer} · {product.sku}</small><b>{amount(product.price,product.currency)} / {product.unit}</b><ToolButton icon="plus" disabled={busy} onClick={()=>{appendLine({...newLine(),name:product.name,sku:product.sku,manufacturer:product.manufacturer,product_id:product.id,type_id:product.type_id,unit:product.unit as 'шт'|'м',unit_price:String(product.price),currency:product.currency,image:typeof product.parameters.image==='string'?product.parameters.image:'',description:typeof product.parameters.description==='string'?product.parameters.description:'',ip:String(product.parameters?.ip??'')});}}>Добавить в КП</ToolButton></article>)}</div>
        {filteredProducts.length>catalogLimit&&<button type="button" onClick={()=>setCatalogLimit(value=>value+100)}>Показать ещё {Math.min(100,filteredProducts.length-catalogLimit)} товаров</button>}
        <p className="hint">Найдено товаров: {filteredProducts.length}</p>
      </section>}
      <fieldset disabled={busy} className="quotation-notes"><label>Условия предложения<textarea aria-label="Условия КП" rows={4} value={doc.terms} onChange={e=>change(q=>({...q,terms:e.target.value}))}/></label></fieldset>
      <details open className="quotation-brand"><summary>Конструктор КП · оформление и реквизиты</summary><div className="quote-designer"><div className="quote-designer-controls"><fieldset disabled={busy} className="quotation-fields">
        {([["title","Заголовок КП"],["seller","Компания"],["city","Город"],["phone","Телефон"],["email","E-mail"],["website","Сайт"],["address","Адрес"],["slogan","Слоган"],["tax_note","Примечание о НДС"]] as const).map(([key,label])=><label key={key}>{label}<input aria-label={label+" КП"} value={doc[key]} onChange={e=>change(q=>({...q,[key]:e.target.value}))}/></label>)}
        <ImageField label="Логотип КП" value={doc.logo} disabled={busy} logo onChange={logo=>change(q=>({...q,logo}))}/>
        {doc.benefits.map((benefit,index)=><label key={index}>Преимущество {index+1}<input aria-label={"Заголовок преимущества "+(index+1)} value={benefit.title} onChange={e=>change(q=>({...q,benefits:q.benefits.map((item,i)=>i===index ? {...item,title:e.target.value} : item)}))}/><input aria-label={"Текст преимущества "+(index+1)} value={benefit.text} onChange={e=>change(q=>({...q,benefits:q.benefits.map((item,i)=>i===index ? {...item,text:e.target.value} : item)}))}/></label>)}
        <button onClick={()=>change(q=>({...q,benefits:[]}))}>Убрать блок преимуществ</button>
      </fieldset>
      <fieldset disabled={busy} className="quote-theme-controls"><legend>Шрифт и цвета</legend>
        <label>Шрифт документа<SearchSelect aria-label="Шрифт документа КП" value={doc.style?.font??'Golos'} onChange={e=>change(q=>({...q,style:{...q.style,font:e.target.value as QuoteStyle['font']}}))}><option value="Golos">Golos Text · исходный</option><option value="DejaVuSans">DejaVu Sans</option><option value="DejaVuSerif">DejaVu Serif</option></SearchSelect></label>
        <label>Размер текста таблицы · {Math.round((doc.style?.table_scale??1)*100)}%<input aria-label="Размер текста таблицы КП" type="range" min="80" max="130" step="5" value={(doc.style?.table_scale??1)*100} onChange={e=>change(q=>({...q,style:{...q.style,table_scale:Number(e.target.value)/100}}))}/></label>
        <p className="hint">Цвета и шрифт применяются к предпросмотру и итоговому PDF. Все шрифты работают без интернета.</p>
        <div className="quote-theme-colors">{quotationColors.map(token=><label key={token.key}><span>{token.label}</span><input type="color" aria-label={'Цвет: '+token.label} value={quotationColor(doc.style,token)} onChange={e=>change(q=>({...q,style:{...q.style,colors:{...q.style?.colors,[token.key]:e.target.value}}}))}/><button type="button" aria-label={'Сбросить цвет: '+token.label} disabled={!doc.style?.colors?.[token.key]} onClick={()=>change(q=>{const colors={...q.style?.colors};delete colors[token.key];return {...q,style:{...q.style,colors}};})}><ActionIcon name="undo"/></button></label>)}</div>
        <ToolButton icon="refresh" onClick={()=>{if(confirm('Вернуть исходные цвета и шрифт КП? Реквизиты и позиции сохранятся.'))change(q=>({...q,style:{}}));}}>Исходное оформление</ToolButton>
        {doc.benefits.length<4&&<ToolButton icon="plus" onClick={()=>change(q=>({...q,benefits:[...q.benefits,{title:'ПРЕИМУЩЕСТВО',text:'Описание'}]}))}>Добавить преимущество</ToolButton>}
      </fieldset></div>{quoteTool==='brand'&&<div className="quote-designer-preview"><QuotationPreview base={base} document={doc} mode={mode}/></div>}</div><p className="hint">Примечание о НДС и гарантийные условия укажите в соответствии с вашими ценами и товарами.</p></details>
    </> : <QuotationPreview base={base} document={doc} mode={mode}/>}
    </div>
    <div className="quotation-dock" role="toolbar" aria-label="Действия с позициями КП">
      <ToolButton icon="plus" aria-label="＋ Добавить строку КП" disabled={busy||doc.lines.length>=5000} onClick={insertNearCurrent}>Добавить строку КП</ToolButton>
      <ToolButton icon="catalog" disabled={busy} onClick={()=>chooseQuoteTool('catalog')}>Добавить из каталога</ToolButton>
      <span className="quotation-insert-hint">{insertionAnchor?'После позиции '+(insertionAnchor.index+1):'В конец списка'}</span>
      <ToolButton icon="undo" disabled={busy||!history.current.length} onClick={()=>undo()}>Отменить правку КП</ToolButton><ToolButton icon="redo" disabled={busy||!future.current.length} onClick={()=>undo(true)}>Вернуть правку КП</ToolButton>
      <ToolButton icon="save" disabled={busy||!dirty} onClick={()=>void work(async()=>{await saveCurrent();setMessage('КП сохранено');})}>Сохранить изменения КП</ToolButton>
      <ToolButton icon="sku" title="Word: наименования, бренды и количество без цен" disabled={busy||!doc.lines.length} onClick={()=>void downloadSku()}>Сделать SKU</ToolButton>
    </div>
    {newProduct && <QuoteDialog title="Новый товар из КП" busy={busy||productImageBusy} onClose={closeNewProduct}>
      <h2>{newProduct.existingId?"Редактирование товара в общей базе":"Новый товар в базу"}</h2><p>{standalone ? "Товар сохранится в общем каталоге и строке КП." : "Товар сохранится в общем каталоге и будет привязан к этой строке и её объектам на плане."}</p>
      {newProduct.existingId&&!catalogue.products.find(item=>item.id===newProduct.existingId)?.active&&<p className="hint">Товар находится в архиве. Сохранение восстановит его в общей базе.</p>}
      <form onSubmit={event=>{event.preventDefault();if(!productImageBusy)void saveProductFromQuote();}}>
        <ProductCardFields context="КП" value={newProduct} disabled={busy} makers={catalogue.manufacturers} requiredType={false} typePlaceholder="Без номенклатуры" types={types.filter(type=>type.active&&type.unit===doc.lines.find(line=>line.id===newProduct.lineId)?.unit&&(!doc.lines.find(line=>line.id===newProduct.lineId)?.source_ids.length||type.id===doc.lines.find(line=>line.id===newProduct.lineId)?.type_id))} onBusyChange={setProductImageBusy} onChange={patch=>{if(['name','sku','manufacturer','typeId'].some(key=>Object.hasOwn(patch,key)))setProductDuplicates(null);setNewProduct(current=>current?{...current,...patch}:null);}}/>
        {error && <p role="alert" className="catalog-error">{error}</p>}
        <div className="modal-actions"><button type="button" disabled={busy||productImageBusy} onClick={closeNewProduct}>Отмена</button><button className="quote-primary" disabled={busy||productImageBusy}>{newProduct.existingId?"Сохранить товар":"Создать и привязать товар"}</button></div>
        {productDuplicates&&<DuplicateProducts matches={productDuplicates} disabled={busy} canEdit={item=>{const line=doc.lines.find(line=>line.id===newProduct.lineId);return Boolean(line&&item.unit===line.unit&&(!line.source_ids.length||(item.type_id===null||item.type_id===line.type_id)));}} onEdit={id=>editCatalogueProduct(newProduct.lineId,id)} onSeparate={()=>void saveProductFromQuote(true)} onCancel={()=>setProductDuplicates(null)}/>}
        {newProduct.existingId&&<ToolButton icon="trash" disabled={busy} onClick={()=>void deleteCatalogueProduct(newProduct.existingId!)}>Удалить товар из базы</ToolButton>}
      </form>
    </QuoteDialog>}
    {attachOpen && <QuoteDialog title="Прикрепить КП к проекту" busy={busy} onClose={()=>{setAttachOpen(false);setError("");}}>
      <h2>Прикрепить КП к проекту</h2>
      <p>КП целиком перейдёт в выбранный проект: позиции, цены, скидки, реквизиты и фотографии сохранятся.</p>
      <label>Проект<SearchSelect aria-label="Проект для КП" disabled={busy} value={attachTarget} onChange={e=>setAttachTarget(e.target.value)}><option value="">Выберите проект</option>{attachProjects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</SearchSelect></label>
      {attachProjects.length===0 && <p className="hint">Сначала создайте проект, затем вернитесь к этому КП и прикрепите его.</p>}
      {attachProjects.find(project=>project.id===Number(attachTarget))?.quote_revision ? <p className="hint">Текущее КП проекта будет сохранено отдельно в списке «КП без проекта».</p> : null}
      <button disabled={busy} onClick={()=>void work(async()=>setAttachProjects(await api<AttachmentProject[]>("/quotations/project-options")))}>Обновить список проектов</button>
      {error && <p className="catalog-error" role="alert">{error}</p>}
      <div className="modal-actions"><button disabled={busy} onClick={()=>setAttachOpen(false)}>Отмена</button><button className="quote-primary" disabled={busy || !attachTarget} onClick={()=>void work(async()=>{
        const target=attachProjects.find(project=>project.id===Number(attachTarget));if(!target)return;
        const saved=await saveCurrent();
        const result=await api<{project_id:number}>(base+"/attach","POST",{revision:saved.revision,project_id:target.id,project_revision:target.quote_revision});
        setAttachOpen(false);setDirty(false);await onAttached?.(result.project_id);
      })}>Прикрепить КП</button></div>
    </QuoteDialog>}
    {imported && <QuoteDialog title="Проверка импорта КП" busy={busy} className="quotation-import-modal" onClose={()=>{setImported(null);setError("");}}>
      <h2>{imported.filename}</h2><p>Распознано позиций: {imported.lines.length}. Проверьте цены и количество. После переноса все строки можно редактировать.</p>
      {imported.warnings.map((warning,index)=><p key={index} className="warning">{warning}</p>)}
      <label>Перенос<SearchSelect aria-label="Режим импорта КП" value={importMode} onChange={e=>setImportMode(e.target.value as "append"|"replace")}><option value="append">Добавить к текущим позициям</option><option value="replace">Заменить позиции текущего КП</option></SearchSelect></label>
      {!!imported.checks?.length && <p className="hint">Суммы совпали с PDF: {imported.checks.filter(check=>check.verified&&!check.modified&&imported.lines.some(line=>line.id===check.line_id)).length}. Отметка относится к исходным значениям. Цена за единицу и скидка перенесены раздельно.</p>}
      <div className="quotation-import-table"><table><thead><tr><th>Наименование / артикул</th><th>Количество</th><th>Ед.</th><th>Цена за ед.</th><th>Скидка %</th><th>Валюта</th><th>Проверка PDF</th><th></th></tr></thead><tbody>{imported.lines.slice(importPage*100,(importPage+1)*100).map((line,offset)=>{
        const index=importPage*100+offset,check=imported.checks?.find(item=>item.line_id===line.id);
        return <tr key={line.id} className={check?.issues.length ? "quotation-import-review" : ""}>
          <td><input aria-label={"Импорт: наименование "+(index+1)} value={line.name} onChange={e=>editImportedLine(line.id,{name:e.target.value})}/><input aria-label={"Импорт: артикул "+(index+1)} placeholder="Артикул" value={line.sku} onChange={e=>editImportedLine(line.id,{sku:e.target.value})}/></td>
          <td><DecimalInput aria-label={"Импорт: количество "+(index+1)}  min=".001" step=".001" value={line.quantity} onChange={e=>editImportedLine(line.id,{quantity:e.target.value})}/></td>
          <td><SearchSelect aria-label={"Импорт: единица "+(index+1)} value={line.unit} onChange={e=>editImportedLine(line.id,{unit:e.target.value as Line["unit"]})}><option>шт</option><option>м</option></SearchSelect></td>
          <td><DecimalInput aria-label={"Импорт: цена "+(index+1)}  min="0" step=".01" value={line.unit_price} onChange={e=>editImportedLine(line.id,{unit_price:e.target.value})}/></td>
          <td><DecimalInput required={false} aria-label={"Импорт: скидка "+(index+1)}  min="0" max="100" step=".01" placeholder="Нет" value={line.discount??""} onChange={e=>editImportedLine(line.id,{discount:e.target.value||null})}/></td>
          <td><input aria-label={"Импорт: валюта "+(index+1)} maxLength={3} value={line.currency} onChange={e=>editImportedLine(line.id,{currency:e.target.value.toUpperCase()})}/></td>
          <td>{check ? <><small>Стр. {check.page}{check.source_total!==null ? " · Сумма "+cash(check.source_total)+" "+line.currency : ""}</small><small>{check.modified ? "Изменено вручную" : check.verified ? "Сумма совпала" : "Проверьте строку"}</small>{check.issues.map((issue,i)=><small key={i} className="warning">{issue}</small>)}</> : "—"}</td>
          <td><button aria-label={"Удалить импортированную строку "+(index+1)} onClick={()=>{
            const lines=imported.lines.filter(item=>item.id!==line.id);setImported({...imported,lines});setImportPage(Math.min(importPage,Math.max(0,Math.ceil(lines.length/100)-1)));
          }}><ActionIcon name="trash"/></button></td>
        </tr>;
      })}</tbody></table></div>
      {imported.lines.length>100 && <div className="quotation-import-pages"><button disabled={importPage===0} onClick={()=>setImportPage(importPage-1)}>Назад</button><span>Строки {importPage*100+1}–{Math.min((importPage+1)*100,imported.lines.length)} из {imported.lines.length}</span><button disabled={(importPage+1)*100>=imported.lines.length} onClick={()=>setImportPage(importPage+1)}>Далее</button></div>}
      {error && <p className="catalog-error" role="alert">{error}</p>}
      <div className="modal-actions"><button onClick={()=>setImported(null)}>Отмена</button><button className="quote-primary" onClick={()=>{
        const invalid=imported.lines.findIndex(line=>!line.name.trim() || !/^\d+(?:[.]\d{1,3})?$/.test(line.quantity) || +line.quantity<=0 || +line.quantity>1000000 || !/^\d+(?:[.]\d{1,2})?$/.test(line.unit_price) || +line.unit_price>1000000000 || !/^[A-Z]{3}$/.test(line.currency) || (line.discount!==null && (!Number.isFinite(+line.discount) || +line.discount<0 || +line.discount>100)));
        if(!imported.lines.length || invalid>=0){setError(invalid>=0 ? "Проверьте название, количество, цену, валюту и скидку в строке "+(invalid+1) : "Нет позиций для переноса");return;}
        if((importMode==="append" ? doc.lines.length : 0)+imported.lines.length>5000){setError("В КП допускается не больше 5000 строк");return;}
        change(q=>({...q,lines:importMode==="append" ? [...q.lines,...imported.lines] : imported.lines}),true);
        setImported(null);setMessage("Позиции перенесены. Проверьте КП и сохраните изменения.");
      }}>Перенести позиции в КП</button></div>
    </QuoteDialog>}
  </section>;
}


function QuoteDialog({title,busy,onClose,children,className=""}:{title:string;busy:boolean;onClose:()=>void;children:React.ReactNode;className?:string}) {
  const node=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const frame=requestAnimationFrame(()=>node.current?.querySelector<HTMLElement>("input,select,button")?.focus());
    return()=>{cancelAnimationFrame(frame);if(previous?.isConnected)previous.focus();};
  },[]);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(event.key==="Escape" && !(event.target as HTMLElement)?.closest('[data-search-popup],[role="combobox"][aria-expanded="true"]')){event.preventDefault();event.stopImmediatePropagation();if(!busy)onClose();}
    };
    window.addEventListener("keydown",key,true);return()=>window.removeEventListener("keydown",key,true);
  },[busy,onClose]);
  return <div ref={node} className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onKeyDown={event=>{
    if(event.key!=="Tab")return;
    const controls=[...event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])")].filter(item=>item.getClientRects().length);
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
  }}><section className={"catalog-modal quotation-product-modal "+className}>{children}</section></div>;
}
