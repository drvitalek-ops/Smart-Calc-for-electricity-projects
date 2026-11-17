import {useMemo,useState} from 'react';
import type {Item,Kind} from './App';
import {matchesSearch} from './SearchSelect';
import {planLabel} from './planLabels';
type Props={items:Item[];types:ReadonlyMap<number,Kind>;rooms:{id:number;name:string}[];selected:ReadonlySet<number>;busy:boolean;onSelect:(item:Item)=>void;onReturn:()=>void};
export default function PlanObjectList({items,types,rooms,selected,busy,onSelect,onReturn}:Props){
 const [query,setQuery]=useState(''),[page,setPage]=useState(0),roomMap=useMemo(()=>new Map(rooms.map(room=>[room.id,room.name])),[rooms]);
 const found=useMemo(()=>items.filter(item=>matchesSearch([planLabel(item,types.get(item.type_id)),roomMap.get(item.room_id??0)??'Без помещения'].join(' '),query)),[items,types,roomMap,query]);
 const pages=Math.max(1,Math.ceil(found.length/50)),current=Math.min(page,pages-1);
 return <section data-tool-section="list" className="plan-object-list" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onReturn();}}}><h3>Объекты на плане</h3><label>Поиск объекта<input type="search" aria-label="Поиск объектов плана" placeholder="Название, номер или помещение" value={query} onChange={event=>{setQuery(event.target.value);setPage(0);}}/></label><p className="hint">Видимые объекты текущих листов: {found.length}. Enter — выбрать и открыть свойства. Esc — вернуться на план.</p>
  <ul aria-label="Объекты текущих листов" onKeyDown={event=>{
   if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
   const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(index<0)return;
   event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowDown'?1:-1)));buttons[next]?.focus();
  }}>{found.slice(current*50,(current+1)*50).map(item=><li key={item.id}><button type="button" disabled={busy} aria-pressed={selected.has(item.id)} aria-label={'Выбрать объект №'+item.id+' — '+planLabel(item,types.get(item.type_id))} onClick={()=>onSelect(item)}><strong>{planLabel(item,types.get(item.type_id))}</strong><small>{roomMap.get(item.room_id??0)??'Без помещения'}</small></button></li>)}</ul>
  {!found.length&&<p>Объекты не найдены. Измените поиск или проверьте видимость слоёв.</p>}
  <nav aria-label="Страницы объектов плана"><button type="button" disabled={current===0} onClick={()=>setPage(current-1)}>Назад</button><span>{current+1} / {pages}</span><button type="button" disabled={current>=pages-1} onClick={()=>setPage(current+1)}>Далее</button></nav>
 </section>;
}
