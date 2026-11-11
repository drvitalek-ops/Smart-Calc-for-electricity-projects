import {useLayoutEffect,useRef,useState,type RefObject} from 'react';

/** Keep the same sheet point under the cursor when zooming. */
export default function usePlanCamera(viewport:RefObject<HTMLDivElement|null>,sheet:RefObject<HTMLDivElement|null>){
  const [zoom,setZoom]=useState(1),current=useRef(1);
  const anchor=useRef<{x:number;y:number;clientX:number;clientY:number}|null>(null);
  function zoomAt(value:number,clientX?:number,clientY?:number){
    if(!Number.isFinite(value))return;
    const next=Math.min(16,Math.max(.1,value)),paper=sheet.current?.getBoundingClientRect(),view=viewport.current?.getBoundingClientRect();
    if(next===current.current)return;
    if(paper&&view&&paper.width&&paper.height){
      const x=clientX??view.left+view.width/2,y=clientY??view.top+view.height/2;
      anchor.current={x:(x-paper.left)/paper.width,y:(y-paper.top)/paper.height,clientX:x,clientY:y};
    }
    current.current=next;setZoom(next);
  }
  useLayoutEffect(()=>{
    const point=anchor.current,paper=sheet.current?.getBoundingClientRect(),view=viewport.current;
    anchor.current=null;
    if(point&&paper&&view){view.scrollLeft+=paper.left+point.x*paper.width-point.clientX;view.scrollTop+=paper.top+point.y*paper.height-point.clientY;}
  },[zoom]);
  function reset(value=1){anchor.current=null;current.current=value;setZoom(value);}
  function fit(){
    const view=viewport.current,paper=sheet.current;if(!view||!paper)return;
    const ratio=paper.offsetHeight/paper.offsetWidth;
    reset(Math.min(16,Math.max(.1,Math.min((view.clientWidth-56)/850,(view.clientHeight-56)/(850*ratio)))));
    requestAnimationFrame(()=>{view.scrollTop=0;view.scrollLeft=0;});
  }
  return {zoom,zoomAt,reset,fit,current};
}
