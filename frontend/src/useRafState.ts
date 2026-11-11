import {useCallback,useEffect,useRef,useState} from 'react';
/** Coalesce high-frequency pointer samples, retaining the final position. */
export default function useRafState<T>(initial:T){
  const [state,setState]=useState(initial),next=useRef(initial),frame=useRef(0);
  useEffect(()=>()=>{cancelAnimationFrame(frame.current);frame.current=0;},[]);
  const update=useCallback((value:T)=>{next.current=value;if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=0;setState(next.current);});},[]);
  return [state,update] as const;
}
