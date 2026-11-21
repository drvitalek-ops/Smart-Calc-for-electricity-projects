import {useLayoutEffect,useState} from 'react';
import type {RefObject} from 'react';
import type {Box} from './planGeometry';
export default function usePlanWindow(viewport:RefObject<HTMLDivElement|null>,sheet:RefObject<HTMLDivElement|null>,pageId:number|null,zoom:number){
  const [bounds,setBounds]=useState<(Box&{visible:Box})|null>(null);
  useLayoutEffect(()=>{
    const container=viewport.current,canvas=sheet.current;if(!container||!canvas){setBounds(null);return;}
    let frame=0;
    const measure=()=>{frame=0;const view=container.getBoundingClientRect(),plan=canvas.getBoundingClientRect();if(!plan.width||!plan.height)return;
      const visible={x1:(view.left+container.clientLeft-plan.left)/plan.width,y1:(view.top+container.clientTop-plan.top)/plan.height,x2:(view.left+container.clientLeft+container.clientWidth-plan.left)/plan.width,y2:(view.top+container.clientTop+container.clientHeight-plan.top)/plan.height};
      const next={visible,x1:(view.left-plan.left-100)/plan.width,y1:(view.top-plan.top-100)/plan.height,x2:(view.right-plan.left+100)/plan.width,y2:(view.bottom-plan.top+100)/plan.height};
      setBounds(previous=>previous&&(['x1','y1','x2','y2'] as const).every(key=>Math.abs(next[key]-previous[key])<.0002&&Math.abs(visible[key]-previous.visible[key])<.0002)?previous:next);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
    measure();container.addEventListener('scroll',schedule,{passive:true});const observer=new ResizeObserver(schedule);observer.observe(container);observer.observe(canvas);
    return()=>{cancelAnimationFrame(frame);container.removeEventListener('scroll',schedule);observer.disconnect();};
  },[viewport,sheet,pageId,zoom]);
  return bounds;
}
