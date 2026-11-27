import {useLayoutEffect,useRef,useState,type RefObject} from 'react';
/** Keep the entire portal on one side of its anchor, including in scrolled dialogs. */
export default function usePopupPosition(anchor:RefObject<HTMLElement|null>,popup:RefObject<HTMLElement|null>,open:boolean,onClose:()=>void,preferredHeight=360){
 const close=useRef(onClose);close.current=onClose;
 const [position,setPosition]=useState({left:8,top:0,width:300,maxHeight:preferredHeight,above:false});
 useLayoutEffect(()=>{
  if(!open)return;
  let previous:typeof position|undefined,frame=0;
  const place=()=>{
   const rect=anchor.current?.getBoundingClientRect();if(!rect)return;
   const viewport=window.visualViewport,left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0,width=viewport?.width??window.innerWidth,height=viewport?.height??window.innerHeight;
   if(rect.bottom<=top||rect.top>=top+height||rect.right<=left||rect.left>=left+width){close.current();return;}
   const gap=5,below=Math.max(0,top+height-rect.bottom-gap-8),above=Math.max(0,rect.top-top-gap-8),up=below<Math.min(180,preferredHeight)&&above>below;
   const popupWidth=Math.min(Math.max(rect.width,300),width-16);
   const next={left:Math.max(left+8,Math.min(rect.left,left+width-popupWidth-8)),top:up?rect.top-gap:rect.bottom+gap,width:popupWidth,maxHeight:Math.min(preferredHeight,up?above:below),above:up};
   if(!previous||Object.keys(next).some(key=>next[key as keyof typeof next]!==previous![key as keyof typeof next])){previous=next;setPosition(next);}
  };
  // A dirty badge, warning or expanded row can move the anchor without a
  // window scroll/resize. Track only while open; unchanged geometry sets no state.
  const track=()=>{place();frame=requestAnimationFrame(track);};
  const move=(event:Event)=>{if(!popup.current?.contains(event.target as Node))place();};
  place();frame=requestAnimationFrame(track);window.addEventListener('resize',place);window.addEventListener('scroll',move,true);window.visualViewport?.addEventListener('resize',place);
  return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',place);window.removeEventListener('scroll',move,true);window.visualViewport?.removeEventListener('resize',place);};
 },[open,preferredHeight,anchor,popup]);
 const {above,...style}=position;return {...style,transform:above?'translateY(-100%)':undefined};
}
