import {memo,useState} from "react";
import './ToolRail.css';
import {Button} from './ui/Controls';
export type ToolItem={id:string;label:string;icon?:string;actionLabel?:string;disabled?:boolean;command?:()=>void};
const shapes:Record<string,React.ReactNode>={
    grip:<><circle cx="8" cy="5" r="1"/><circle cx="16" cy="5" r="1"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/><circle cx="8" cy="19" r="1"/><circle cx="16" cy="19" r="1"/></>,
    print:<><path d="M6 8V3h12v5M6 17H3V8h18v9h-3M6 14h12v7H6Z"/><path d="M17 11h1"/></>,
    cursor:<path d="m5 3 14 9-7 1-3 7Z"/>,objects:<><circle cx="7" cy="7" r="3"/><rect x="14" y="4" width="6" height="6"/><path d="m7 14 4 6H3Z"/><circle cx="17" cy="17" r="3"/></>,
    frame:<><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M9 6v12m6-12v12"/></>,room:<><path d="M3 4h18v16H3Zm4 0v4m14 8h-4"/><path d="M7 12h7m-3-3 3 3-3 3"/></>,
    layers:<><path d="m12 3 10 5-10 5L2 8Zm-9 9 9 5 9-5m-18 5 9 5 9-5"/></>,pages:<><rect x="7" y="3" width="14" height="17" rx="1"/><path d="M3 7v15h13m-5-14h6m-6 4h6"/></>,
    palette:<><path d="M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h3a5 5 0 0 0 5-5c0-3-4-5-9-5Z"/><circle cx="7" cy="9" r=".8"/><circle cx="11" cy="6" r=".8"/><circle cx="16" cy="7" r=".8"/></>,
    catalog:<><path d="M3 5h7l2 3 2-3h7v15h-7l-2 2-2-2H3Z"/><path d="M12 8v14M6 10h3m-3 4h3m6-4h3m-3 4h3"/></>,
    edit:<><path d="m16 3 5 5-12 12H4v-5Zm-2 2 5 5M3 22h18"/></>,save:<><path d="M4 3h13l4 4v14H3V3Zm3 0v7h10V3M7 21v-7h10v7"/></>,
    import:<><path d="M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6"/></>,pdf:<><path d="M5 2h10l5 5v15H5Zm10 0v6h5"/><path d="M8 16h9m-9-4h4"/></>,eye:<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
    sku:<><path d="M5 2h10l5 5v15H5Zm10 0v6h5"/><path d="M8 11h9v8H8Zm0 3h9m-4-3v8"/></>,
    eyeOff:<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM3 3l18 18"/></>,lock:<><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/></>,unlock:<><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0"/></>,
    undo:<><path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12"/></>,redo:<><path d="m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/></>,
    plus:<path d="M12 4v16M4 12h16"/>,trash:<><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></>,copy:<><rect x="7" y="7" width="14" height="14" rx="2"/><path d="M17 7V3H3v14h4"/></>,
    link:<><path d="m9 15 6-6m-5-3 2-2a5 5 0 0 1 7 7l-2 2m-3 5-2 2a5 5 0 0 1-7-7l2-2"/></>,list:<><path d="M8 6h13M8 12h13M8 18h13M3 6h1m-1 6h1m-1 6h1"/></>,
    settings:<><path d="M3 6h7m5 0h6M3 12h3m5 0h10M3 18h10m5 0h3"/><circle cx="12" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="15" cy="18" r="2"/></>,
    refresh:<><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/></>,back:<path d="M20 12H4m6-6-6 6 6 6"/>,
    folder:<><path d="M3 7V5h7l2 2h9v13H3Z"/><path d="M3 10h18"/></>,
    fit:<><path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/><rect x="7" y="7" width="10" height="10" rx="1"/></>,
    zoomIn:<><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6m-3-3v6"/></>,zoomOut:<><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6"/></>,
    magnet:<><path d="M5 4v9a7 7 0 0 0 14 0V4h-4v9a3 3 0 0 1-6 0V4Z"/><path d="M5 8h4m6 0h4"/></>,
    ortho:<><path d="M5 3v16h16M5 14h5v5"/><path d="m17 16 4 3-4 3M2 7l3-4 3 4"/></>,
    measure:<><path d="m3 15 12-12 6 6L9 21Z"/><path d="m7 12 3 3m0-6 2 2m1-5 3 3"/></>,
    grid:<><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M9 3v18m6-18v18M3 9h18M3 15h18"/></>,
    hand:<path d="M8 12V5a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v10c0 4-3 7-7 7h-1c-2 0-4-1-5-3l-4-6a2 2 0 0 1 3-3l2 2Z"/>,
    crosshair:<><circle cx="12" cy="12" r="6"/><path d="M12 2v6m0 8v6M2 12h6m8 0h6"/></>,
    help:<><circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3c-1 .4-1 1-1 2m0 3h.01"/></>,
    close:<path d="m6 6 12 12M6 18 18 6"/>,pin:<><path d="m15 3 6 6-4 1-3 5-3-1-5 5m2-7-1-3 5-3Z"/></>,
    chevronLeft:<path d="m15 5-7 7 7 7"/>,chevronRight:<path d="m9 5 7 7-7 7"/>,
    search:<><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>,
    photo:<><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></>,
    check:<path d="m5 12 4 4L20 5"/>,warning:<><path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3h.01"/></>,
    keyboard:<><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M7 16h10"/></>,
  };

export const ActionIcon=memo(function ActionIcon({name='edit',className=''}:{name?:string;className?:string}) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]??shapes.edit}</svg>;
});
export default function ToolRail({items,active,onSelect,label,side='left',panelExpanded,onTogglePanel}:{items:ToolItem[];active:string|null;onSelect:(id:string)=>void;label:string;side?:'left'|'right';panelExpanded?:boolean;onTogglePanel?:()=>void}) {
  const [expanded,setExpanded]=useState(false);
  return <div className={'tool-rail-slot tool-rail-'+side}><nav className="tool-rail" data-expanded={expanded} aria-label={label} onPointerEnter={()=>setExpanded(true)} onPointerLeave={()=>setExpanded(false)} onFocus={event=>{if((event.target as HTMLElement).matches(":focus-visible"))setExpanded(true);}} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setExpanded(false);}}>{onTogglePanel&&<button type="button" className="rail-disclosure" aria-label={(panelExpanded?'Свернуть':'Развернуть')+(side==='left'?' левую панель':' правую панель')} aria-expanded={panelExpanded} onClick={()=>{setExpanded(false);onTogglePanel();}}><ActionIcon name="chevronRight" className={'rail-arrow '+(Boolean(panelExpanded)!==(side==='right')?'rail-arrow-reversed':'')}/><span>{panelExpanded?'Свернуть панель':'Развернуть панель'}</span></button>}{items.map(item=><button key={item.id} type="button" disabled={item.disabled} className={active===item.id ? 'active' : ''} aria-label={item.actionLabel || 'Инструмент: '+item.label} title={item.label} aria-pressed={item.command ? undefined : active===item.id} onClick={()=>{setExpanded(false);if(item.command)item.command();else onSelect(item.id);}}><ActionIcon name={item.icon || item.id}/><span>{item.label}</span></button>)}</nav></div>;
}
export function ToolButton({icon='edit',children,...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&{icon?:string}) {return <Button {...props} title={props.title??(typeof children==='string'?children:undefined)} className={'tool-action '+(props.className??'')}><ActionIcon name={icon}/><span>{children}</span></Button>;}
