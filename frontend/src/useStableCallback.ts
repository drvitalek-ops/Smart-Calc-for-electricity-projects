import {useCallback,useLayoutEffect,useRef} from 'react';
/** Stable identity for pointer handlers; always uses the committed render's state. */
export default function useStableCallback<A extends unknown[],R>(handler:(...args:A)=>R){
  const current=useRef(handler);
  useLayoutEffect(()=>{current.current=handler;});
  return useCallback((...args:A)=>current.current(...args),[]);
}
