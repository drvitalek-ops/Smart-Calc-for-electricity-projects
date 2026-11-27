import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {matchesArticle,matchesSearch,SearchHighlight,type SearchOption} from './SearchSelect';
import usePopupPosition from './usePopupPosition';

type Props=Omit<React.InputHTMLAttributes<HTMLInputElement>,'value'|'onChange'|'list'> & {
  value:string;productId:number|null;options:readonly SearchOption[];
  onChange:(value:string)=>void;onChoose:(id:string)=>void;
};

/** Free text stays editable; only an explicit catalogue choice binds a good. */
export default function ProductSearchInput({value,productId,options,onChange,onChoose,...props}:Props){
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(-1),[limit,setLimit]=useState(50);
  const root=useRef<HTMLSpanElement>(null),input=useRef<HTMLInputElement>(null),popup=useRef<HTMLDivElement>(null),id=useId();
  const position=usePopupPosition(input,popup,open,()=>setOpen(false),320);
  const label=props['aria-label']??'Позиция КП';
  const filtered=useMemo(()=>open?options.filter(option=>option.value&&!option.disabled&&
    (matchesSearch(option.label+' '+(option.group??''),query)||matchesArticle(option.sku??'',query))):[],[open,options,query]);
  function show(search=''){if(props.disabled)return;setQuery(search);setActive(search.trim()?0:-1);setLimit(50);setOpen(true);}
  function choose(option:SearchOption){setOpen(false);onChoose(option.value);}
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node)&&!popup.current?.contains(event.target as Node))setOpen(false);};
    document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
  },[open]);
  useEffect(()=>{if(props.disabled)setOpen(false);},[props.disabled]);
  useEffect(()=>{
    const option=popup.current?.querySelector<HTMLElement>('[data-active="true"]'),list=popup.current?.querySelector<HTMLElement>('[role="listbox"]');
    if(!option||!list)return;
    const itemRect=option.getBoundingClientRect(),listRect=list.getBoundingClientRect();
    if(itemRect.top<listRect.top)list.scrollTop+=itemRect.top-listRect.top;
    else if(itemRect.bottom>listRect.bottom)list.scrollTop+=itemRect.bottom-listRect.bottom;
  },[active,query,open]);
  return <span ref={root} className="search-input product-search-input"><input {...props} ref={input} value={value}
    role="combobox" aria-autocomplete="list" autoComplete="off" aria-expanded={open} aria-controls={open?id:undefined}
    aria-activedescendant={open&&filtered[active]?id+'-'+active:undefined}
    onFocus={event=>{props.onFocus?.(event);event.currentTarget.select();show();}} onClick={()=>{if(!open){input.current?.select();show();}}}
    onBlur={event=>{props.onBlur?.(event);setOpen(false);}}
    onChange={event=>{onChange(event.target.value);show(event.target.value);}}
    onKeyDown={event=>{
      props.onKeyDown?.(event);if(event.defaultPrevented)return;
      if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();setOpen(false);}
      else if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault();event.stopPropagation();
        if(!open){show();setActive(0);}else setActive(current=>{const next=Math.max(0,Math.min(filtered.length-1,current<0?(event.key==='ArrowDown'?0:filtered.length-1):current+(event.key==='ArrowDown'?1:-1)));setLimit(count=>Math.max(count,next+1));return next;});
      }else if(event.key==='Enter'&&open){event.preventDefault();event.stopPropagation();if(active>=0&&filtered[active])choose(filtered[active]);else setOpen(false);}
    }}/><button type="button" className="search-input-arrow" aria-label={'Найти товар: '+label} disabled={props.disabled}
      onPointerDown={event=>event.preventDefault()} onClick={()=>{input.current?.focus({preventScroll:true});input.current?.select();show();}}>▾</button>
    {open&&createPortal(<div ref={popup} data-search-popup className="search-select-popup product-search-popup" style={position}>
      <div className="search-select-options" role="listbox" aria-label={'Товары: '+label} id={id}>
        {filtered.slice(0,limit).map((option,index)=><button key={option.value} type="button" role="option" id={id+'-'+index}
          aria-selected={option.value===String(productId??'')} data-active={active===index}
          onPointerDown={event=>event.preventDefault()} onClick={()=>choose(option)}>
          <span className="search-option-main">{option.image&&<img className="search-option-image" src={option.image} alt=""/>}
            <span className="search-option-copy"><span><SearchHighlight text={option.label} query={query}/></span>
              {option.group&&<small><SearchHighlight text={option.group} query={query}/></small>}</span></span>
        </button>)}
        {filtered.length>limit&&<button type="button" onPointerDown={event=>event.preventDefault()} onClick={()=>setLimit(count=>count+50)}>Показать ещё {Math.min(50,filtered.length-limit)}</button>}
        {!filtered.length&&<p>Товар не найден. Можно оставить введённый текст и заполнить позицию вручную.</p>}
      </div><small className="search-select-count" aria-live="polite">Найдено: {filtered.length}. Выберите товар для привязки. Ручной ввод сохраняется без выбора.</small>
    </div>,root.current?.closest('[role="dialog"]')||document.body)}
  </span>;
}
