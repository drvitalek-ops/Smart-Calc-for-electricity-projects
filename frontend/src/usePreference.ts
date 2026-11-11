import {useCallback,useSyncExternalStore} from 'react';
import type {SetStateAction} from 'react';
const values=new Map<string,unknown>(),listeners=new Map<string,Set<()=>void>>(),writes=new Map<string,ReturnType<typeof setTimeout>>();
const prefix='smart-home-calc:workbench:';
let listening=false;
function notify(key:string){for(const listener of listeners.get(key)??[])listener();}
function read<T>(key:string,fallback:T,valid?:(value:unknown)=>value is T):T{
  if(!values.has(key)){try{values.set(key,JSON.parse(localStorage.getItem(prefix+key)??'null'));}catch{values.set(key,null);}}
  const value=values.get(key);return (valid?valid(value):typeof value===typeof fallback)?value as T:fallback;
}
export default function usePreference<T extends string|number|boolean>(key:string,fallback:T,valid?:(value:unknown)=>value is T){
  const subscribe=useCallback((listener:()=>void)=>{
    const group=listeners.get(key)??new Set();group.add(listener);listeners.set(key,group);
    if(!listening){listening=true;window.addEventListener('storage',event=>{if(!event.key?.startsWith(prefix))return;const changed=event.key.slice(prefix.length);try{values.set(changed,event.newValue===null?null:JSON.parse(event.newValue));}catch{values.set(changed,null);}notify(changed);});}
    return()=>{group.delete(listener);};
  },[key]);
  const snapshot=useCallback(()=>read(key,fallback,valid),[key,fallback,valid]);
  const value=useSyncExternalStore(subscribe,snapshot,()=>fallback);
  const setValue=useCallback((next:SetStateAction<T>)=>{
    const current=read(key,fallback,valid),resolved=typeof next==='function'?(next as (value:T)=>T)(current):next;
    if(Object.is(current,resolved))return;
    values.set(key,resolved);notify(key);
    clearTimeout(writes.get(key));writes.set(key,setTimeout(()=>{writes.delete(key);try{localStorage.setItem(prefix+key,JSON.stringify(resolved));}catch{}},150));
  },[key,fallback,valid]);
  return [value,setValue] as const;
}
