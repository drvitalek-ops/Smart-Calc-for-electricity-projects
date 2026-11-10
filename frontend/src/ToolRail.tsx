import {useState} from "react";
import './ToolRail.css';
export type ToolItem={id:string;label:string;icon?:string;actionLabel?:string;disabled?:boolean;command?:()=>void};
export function ActionIcon({name='edit'}:{name?:string}) {
  const shapes:Record<string,React.ReactNode>={
    cursor:<path d="m5 3 14 9-7 1-3 7Z"/>,objects:<><circle cx="7" cy="7" r="3"/><rect x="14" y="4" width="6" height="6"/><path d="m7 14 4 6H3Z"/><circle cx="17" cy="17" r="3"/></>,
    frame:<><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M9 6v12m6-12v12"/></>,room:<><path d="M3 4h18v16H3Zm4 0v4m14 8h-4"/><path d="M7 12h7m-3-3 3 3-3 3"/></>,
    layers:<><path d="m12 3 10 5-10 5L2 8Zm-9 9 9 5 9-5m-18 5 9 5 9-5"/></>,pages:<><rect x="7" y="3" width="14" height="17" rx="1"/><path d="M3 7v15h13m-5-14h6m-6 4h6"/></>,
    palette:<><path d="M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h3a5 5 0 0 0 5-5c0-3-4-5-9-5Z"/><circle cx="7" cy="9" r=".8"/><circle cx="11" cy="6" r=".8"/><circle cx="16" cy="7" r=".8"/></>,
    catalog:<><path d="M3 5h7l2 3 2-3h7v15h-7l-2 2-2-2H3Z"/><path d="M12 8v14M6 10h3m-3 4h3m6-4h3m-3 4h3"/></>,
    edit:<><path d="m16 3 5 5-12 12H4v-5Zm-2 2 5 5M3 22h18"/></>,save:<><path d="M4 3h13l4 4v14H3V3Zm3 0v7h10V3M7 21v-7h10v7"/></>,
    import:<><path d="M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6"/></>,pdf:<><path d="M5 2h10l5 5v15H5Zm10 0v6h5"/><path d="M8 16h9m-9-4h4"/></>,eye:<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
    eyeOff:<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM3 3l18 18"/></>,lock:<><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/></>,unlock:<><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0"/></>,
    undo:<><path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12"/></>,redo:<><path d="m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/></>,
    plus:<path d="M12 4v16M4 12h16"/>,trash:<><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></>,copy:<><rect x="7" y="7" width="14" height="14" rx="2"/><path d="M17 7V3H3v14h4"/></>,
    link:<><path d="m9 15 6-6m-5-3 2-2a5 5 0 0 1 7 7l-2 2m-3 5-2 2a5 5 0 0 1-7-7l2-2"/></>,list:<><path d="M8 6h13M8 12h13M8 18h13M3 6h1m-1 6h1m-1 6h1"/></>,
    settings:<><path d="m9 3-1 3-4 1-2 5 3 3v4l5 3 4-2 4 1 4-5-2-4 1-4-5-3-4 1Z"/><circle cx="12" cy="12" r="3"/></>,refresh:<><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/></>,back:<path d="M20 12H4m6-6-6 6 6 6"/>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]??shapes.edit}</svg>;
}
export default function ToolRail({items,active,onSelect,label,side='left'}:{items:ToolItem[];active:string|null;onSelect:(id:string)=>void;label:string;side?:'left'|'right'}) {
  const [expanded,setExpanded]=useState(false);
  return <div className={'tool-rail-slot tool-rail-'+side}><nav className="tool-rail" data-expanded={expanded} aria-label={label} onPointerEnter={()=>setExpanded(true)} onPointerLeave={()=>setExpanded(false)} onFocus={event=>{if((event.target as HTMLElement).matches(":focus-visible"))setExpanded(true);}} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setExpanded(false);}}>{items.map(item=><button key={item.id} type="button" disabled={item.disabled} className={active===item.id ? 'active' : ''} aria-label={item.actionLabel || 'Инструмент: '+item.label} title={item.label} aria-pressed={item.command ? undefined : active===item.id} onClick={()=>{setExpanded(false);if(item.command)item.command();else onSelect(item.id);}}><ActionIcon name={item.icon || item.id}/><span>{item.label}</span></button>)}</nav></div>;
}
export function ToolButton({icon='edit',children,...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&{icon?:string}) {return <button {...props} className={'tool-action '+(props.className??'')}><ActionIcon name={icon}/><span>{children}</span></button>;}
