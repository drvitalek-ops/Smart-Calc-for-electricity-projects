import {useEffect} from 'react';
type NativeWindow=Window&{chrome?:{webview?:{postMessage:(message:unknown)=>void}}};
/** WebView2's native window close is separate from browser navigation. */
export function useDesktopState(dirty:boolean,busy:boolean){
  useEffect(()=>{try{(window as NativeWindow).chrome?.webview?.postMessage({type:'workbench-state',dirty,busy});}catch{}},[dirty,busy]);
  useEffect(()=>{
    if(!dirty)return;
    const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload);
  },[dirty]);
}
