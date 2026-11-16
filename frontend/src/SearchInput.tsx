import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import usePopupPosition from './usePopupPosition';
import {matchesSearch,SearchHighlight} from './SearchSelect';
type Props=Omit<React.InputHTMLAttributes<HTMLInputElement>,'onChange'|'value'|'list'> & {value:string;options:string[];onChange:(value:string)=>void};
/** The selected value and the user's search are separate: reopening always lists all options. */
export default function SearchInput({value,options,onChange,...props}:Props){
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(-1);
  const root=useRef<HTMLSpanElement>(null),input=useRef<HTMLInputElement>(null),popup=useRef<HTMLDivElement>(null),id=useId();
  const changeRef=useRef(onChange),initialValue=useRef(value);changeRef.current=onChange;
  const position=usePopupPosition(input,popup,open,()=>close(),250);
  const list=[...new Set(options)].filter(option=>matchesSearch(option,query));
  function show(initial=''){if(props.disabled)return;if(!open)initialValue.current=value;setQuery(initial);setActive(-1);setOpen(true);}
  function close(commit=true){if(commit&&query.trim())changeRef.current(query.trim());setOpen(false);setQuery('');}
  function choose(option:string){changeRef.current(option);setOpen(false);setQuery('');input.current?.focus();}
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node)&&!popup.current?.contains(event.target as Node))close();};
    document.addEventListener('pointerdown',outside);
    return()=>{document.removeEventListener('pointerdown',outside);};
  },[open,query]);
  return <span className="search-input" ref={root}><input {...props} ref={input} value={open?query:value} placeholder={open?value:props.placeholder}
    role="combobox" aria-expanded={open} aria-controls={open?id:undefined} aria-autocomplete="list" aria-activedescendant={open&&active>=0?id+'-'+active:undefined} autoComplete="off"
    onFocus={event=>{props.onFocus?.(event);show();}} onClick={()=>{if(!open)show();}}
    onBlur={event=>{props.onBlur?.(event);close();}}
    onChange={event=>{setOpen(true);setQuery(event.target.value);setActive(-1);changeRef.current(event.target.value);}}
    onPaste={event=>{props.onPaste?.(event);if(event.defaultPrevented)return;const text=event.clipboardData.getData('text/plain');if(!open&&text){event.preventDefault();show(text);changeRef.current(text);}}}
    onKeyDown={event=>{
      props.onKeyDown?.(event);if(event.defaultPrevented)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();changeRef.current(initialValue.current);close(false);}
      else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(!open)show();else setActive(i=>i<0?(event.key==='ArrowDown'?0:list.length-1):Math.max(-1,Math.min(list.length-1,i+(event.key==='ArrowDown'?1:-1))));}
      else if(event.key==='Enter'&&open){event.preventDefault();if(active>=0&&list[active])choose(list[active]);else close();}
      else if(!open&&event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();show(event.key);changeRef.current(event.key);}
    }}/><button type="button" className="search-input-arrow" aria-label={'Открыть весь список: '+(props['aria-label']??'значения')} disabled={props.disabled} onPointerDown={e=>e.preventDefault()} onClick={()=>{input.current?.focus();show();}}>▾</button>
    {open&&createPortal(<div ref={popup} data-search-popup className="search-select-popup" style={position}>
      <div role="listbox" id={id} className="search-select-options" >{list.map((option,i)=><button key={option} type="button" role="option" id={id+'-'+i} aria-selected={option===value} data-active={i===active} onPointerDown={event=>event.preventDefault()} onClick={()=>choose(option)}><SearchHighlight text={option} query={query}/></button>)}
      {query.trim()&&!options.some(option=>option.toLocaleLowerCase('ru')===query.trim().toLocaleLowerCase('ru'))&&<button type="button" className="search-input-create" onPointerDown={event=>event.preventDefault()} onClick={()=>choose(query.trim())}>Использовать «{query.trim()}»</button>}
      {!list.length&&!query&&<p>Введите название</p>}</div><small className="search-select-count">Можно ввести своё значение</small>
    </div>,root.current?.closest('[role="dialog"]')||document.body)}
  </span>;
}
