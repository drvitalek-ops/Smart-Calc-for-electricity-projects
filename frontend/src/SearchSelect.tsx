import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import './SearchSelect.css';

type Props=React.SelectHTMLAttributes<HTMLSelectElement>;
type Option={value:string;label:string;group:string;disabled:boolean};
const fold=(value:string)=>value.toLocaleLowerCase('ru').replaceAll('ё','е');

export const matchesSearch=(text:string,query:string)=>fold(text).includes(fold(query.trim()));
export function SearchHighlight({text,query}:{text:string;query:string}) {
  const needle=fold(query.trim());if(!needle)return <>{text}</>;
  const parts:React.ReactNode[]=[];let offset=0,index=fold(text).indexOf(needle);
  while(index>=0){parts.push(text.slice(offset,index),<mark key={index}>{text.slice(index,index+needle.length)}</mark>);offset=index+needle.length;index=fold(text).indexOf(needle,offset);}
  parts.push(text.slice(offset));return <>{parts}</>;
}

/** Native select remains the form control; the searchable picker also supports
 * dynamically rendered optgroups, required fields and existing change handlers. */
export default function SearchSelect(props:Props) {
  const select=useRef<HTMLSelectElement>(null),popup=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null);
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[options,setOptions]=useState<Option[]>([]),[active,setActive]=useState(0);
  const [position,setPosition]=useState({left:0,top:0,width:260,height:280,above:false});
  const id=useId();
  const filtered=options.filter(option=>fold(option.label+' '+option.group).includes(fold(query.trim())));
  const [derivedLabel,setDerivedLabel]=useState('');
  const label=props['aria-label'] || derivedLabel || 'Выбор значения';
  useLayoutEffect(()=>{
    if(props['aria-label'])return;
    const nativeLabel=select.current?.labels?.[0]?.cloneNode(true) as HTMLElement|undefined;
    nativeLabel?.querySelectorAll('select,.search-select').forEach(node=>node.remove());
    setDerivedLabel(nativeLabel?.textContent?.trim() || 'Выбор значения');
  },[props['aria-label']]);
  function show(initial='') {
    if(props.disabled || !select.current)return;
    const items=Array.from(select.current.options).map(option=>({value:option.value,label:option.label,
      group:option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : '',
      disabled:option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled)}));
    setOptions(items);setQuery(initial);setActive(initial ? 0 : Math.max(0,items.findIndex(item=>item.value===select.current?.value)));setOpen(true);
  }
  function close(focus=false) {setOpen(false);if(focus)select.current?.focus({preventScroll:true});}
  function choose(option:Option) {
    if(option.disabled || !select.current)return;
    select.current.value=option.value;
    select.current.dispatchEvent(new Event('change',{bubbles:true}));close(true);
  }
  function place() {
    if(!select.current)return;
    const rect=select.current.getBoundingClientRect(),width=Math.min(Math.max(rect.width,300),window.innerWidth-16);
    if(rect.bottom<0||rect.top>window.innerHeight){close();return;}
    const below=window.innerHeight-rect.bottom-12,above=rect.top-12;
    setPosition({left:Math.max(8,Math.min(rect.left,window.innerWidth-width-8)),top:rect.top,width,height:Math.max(100,Math.min(340,below<160&&above>below ? above : below)),above:below<160&&above>below});
  }
  useLayoutEffect(()=>{
    if(!open)return;
    place();input.current?.focus({preventScroll:true});
  },[open]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!popup.current?.contains(event.target as Node)&&event.target!==select.current)close();};
    const move=(event:Event)=>{if(!popup.current?.contains(event.target as Node))place();};
    document.addEventListener('pointerdown',outside);window.addEventListener('resize',move);window.addEventListener('scroll',move,true);
    return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',move);window.removeEventListener('scroll',move,true);};
  },[open]);
  useEffect(()=>{if(props.disabled)setOpen(false);},[props.disabled]);
  useEffect(()=>{
    const option=popup.current?.querySelector<HTMLElement>('[data-active="true"]'),list=popup.current?.querySelector<HTMLElement>('[role="listbox"]');
    if(!option||!list)return;
    const itemRect=option.getBoundingClientRect(),listRect=list.getBoundingClientRect();
    if(itemRect.top<listRect.top)list.scrollTop+=itemRect.top-listRect.top;
    else if(itemRect.bottom>listRect.bottom)list.scrollTop+=itemRect.bottom-listRect.bottom;
  },[active,query,open]);

  function highlight(value:string) {return <SearchHighlight text={value} query={query}/>;}
  return <span className="search-select">
    <select {...props} ref={select} aria-label={label} title={props.title || "Начните вводить название для поиска"} aria-expanded={open} aria-controls={open ? id : undefined} onChange={event=>{close();props.onChange?.(event);}}
      onPointerDown={event=>{props.onPointerDown?.(event);if(event.button===0&&!event.defaultPrevented){event.preventDefault();select.current?.focus({preventScroll:true});show();}}}
      onKeyDown={event=>{props.onKeyDown?.(event);if(event.defaultPrevented)return;
        if(['ArrowDown','ArrowUp','Enter',' '].includes(event.key)){event.preventDefault();show();}
        else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();show(event.key);}
      }}/>
    {open && createPortal(<div ref={popup} data-search-popup="true" className={'search-select-popup'+(position.above ? ' search-select-above' : '')}
      style={{left:position.left,top:position.top,width:position.width}} onKeyDown={event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}
        if(event.key==='Tab'){event.stopPropagation();close(true);}
      }}>
      <div className="search-select-query"><input ref={input} aria-label={'Поиск в списке: '+label} role="combobox" aria-expanded="true" aria-controls={id}
        aria-activedescendant={filtered[active] ? id+'-'+active : undefined} autoComplete="off" placeholder="Начните вводить название…" value={query}
        onChange={event=>{setQuery(event.target.value);setActive(0);}} onKeyDown={event=>{
          if(event.key==='ArrowDown'||event.key==='ArrowUp'){
            event.preventDefault();event.stopPropagation();setActive(current=>{const step=event.key==='ArrowDown'?1:-1;let next=current+step;while(next>=0&&next<filtered.length&&filtered[next].disabled)next+=step;return next>=0&&next<filtered.length ? next : current;});
          } else if(event.key==='Enter'){event.preventDefault();event.stopPropagation();if(filtered[active])choose(filtered[active]);}
        }}/><button type="button" aria-label="Очистить поиск" onClick={()=>{setQuery('');setActive(0);input.current?.focus({preventScroll:true});}}>×</button></div>
      <div className="search-select-options" role="listbox" id={id} aria-label={label} style={{maxHeight:position.height}}>
        {filtered.map((option,index)=><button key={option.value+'-'+index} type="button" role="option" id={id+'-'+index} aria-selected={option.value===String(props.value??'')}
          aria-disabled={option.disabled} data-active={index===active} disabled={option.disabled} onPointerDown={event=>event.preventDefault()} onClick={()=>choose(option)}>
          <span>{highlight(option.label)}</span>{option.group && <small>{highlight(option.group)}</small>}
        </button>)}
        {!filtered.length && <p>Ничего не найдено</p>}
      </div><small className="search-select-count" aria-live="polite">Найдено: {filtered.length}</small>
    </div>,select.current?.closest('[role="dialog"]') || document.body)}
  </span>;
}
