import {useEffect,useRef,useState} from 'react';
import type {exportIssues} from './quotationPrices';
type Issue=ReturnType<typeof exportIssues>[number];
export default function QuotePreflight({issues,onSelect}:{issues:Issue[];onSelect:(issue:Issue)=>void}){
 const [page,setPage]=useState(0),[filter,setFilter]=useState(''),[open,setOpen]=useState(false),root=useRef<HTMLDetailsElement>(null);
 const filtered=issues.filter(item=>!filter||item.missing.includes(filter)),pages=Math.max(1,Math.ceil(filtered.length/20)),current=Math.min(page,pages-1);
 useEffect(()=>{if(!open)return;const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[open]);
 if(!issues.length)return null;
 return <details ref={root} open={open} className="quotation-export-check" onToggle={event=>{if(event.currentTarget.open!==open)setOpen(event.currentTarget.open);}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);root.current?.querySelector('summary')?.focus();}}}>
  <summary>Перед PDF: без цены — {issues.filter(i=>i.missing.includes('цена')).length}, без фото — {issues.filter(i=>i.missing.includes('фото')).length}, без артикула — {issues.filter(i=>i.missing.includes('артикул')).length}</summary>
  <div className="quote-check-panel" aria-label="Незаполненные позиции КП"><div className="quote-check-filters">{[['','Все пропуски'],['цена','Без цены'],['фото','Без фото'],['артикул','Без артикула']].map(([value,label])=><button key={value} type="button" aria-pressed={filter===value} onClick={()=>{setFilter(value);setPage(0);}}>{label}</button>)}</div>
   <ul>{filtered.slice(current*20,(current+1)*20).map(item=><li key={item.id}><button type="button" onClick={()=>{setOpen(false);onSelect(item);}}>№ {item.index+1} · {item.name} — {item.missing.join(', ')}</button></li>)}</ul>
   {!filtered.length&&<p>Для выбранного условия пропусков нет.</p>}
   <nav aria-label="Страницы проверки КП"><button type="button" disabled={current===0} onClick={()=>setPage(current-1)}>Назад</button><span>Страница {current+1} из {pages} · позиций: {filtered.length}</span><button type="button" disabled={current>=pages-1} onClick={()=>setPage(current+1)}>Далее</button></nav>
  </div>
 </details>;
}
