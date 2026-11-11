import {useLayoutEffect,useState} from 'react';
import type {RefObject} from 'react';
import type {Box} from './planGeometry';
export default function usePlanWindow(viewport:RefObject<HTMLDivElement|null>,sheet:RefObject<HTMLDivElement|null>,pageId:number|null,zoom:number){
  const [bounds,setBounds]=useState<Box|null>(null);
  useLayoutEffect(()=>{
    const container=viewport.current,canvas=sheet.current;if(!container||!canvas){setBounds(null);return;}
    let frame=0;
    const measure=()=>{frame=0;const view=container.getBoundingClientRect(),plan=canvas.getBoundingClientRect();if(!plan.width||!plan.height)return;
      const next={x1:(view.left-plan.left-100)/plan.width,y1:(view.top-plan.top-100)/plan.height,x2:(view.right-plan.left+100)/plan.width,y2:(view.bottom-plan.top+100)/plan.height};
      setBounds(previous=>previous&&Object.keys(next).every(key=>Math.abs(next[key as keyof Box]-previous[key as keyof Box])<.0002)?previous:next);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
    measure();container.addEventListener('scroll',schedule,{passive:true});const observer=new ResizeObserver(schedule);observer.observe(container);observer.observe(canvas);
    return()=>{cancelAnimationFrame(frame);container.removeEventListener('scroll',schedule);observer.disconnect();};
  },[viewport,sheet,pageId,zoom]);
  return bounds;
}
