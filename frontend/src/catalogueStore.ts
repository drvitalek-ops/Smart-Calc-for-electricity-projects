import {useSyncExternalStore} from 'react';
import {api,errorMessage} from './errors';
import type {Catalog,Kind} from './App';
export type CatalogueSnapshot=Catalog&{types:Kind[]};
let snapshot:CatalogueSnapshot={manufacturers:[],suppliers:[],products:[],categories:[],types:[]};
const listeners=new Set<()=>void>();
let pending:Promise<CatalogueSnapshot>|null=null,requested=0,completed=-1,lastSuccess=0;
let channel:BroadcastChannel|null=null;
export function publishCatalogue(value:Catalog){snapshot={...snapshot,...value};for(const listener of listeners)listener();}
export function publishTypes(types:Kind[]){snapshot={...snapshot,types};for(const listener of listeners)listener();}
export function refreshCatalogue():Promise<CatalogueSnapshot>{
  if(pending)return pending;
  if(completed===requested&&Date.now()-lastSuccess<200)return Promise.resolve(snapshot);
  pending=(async()=>{do{
    const version=requested;
    const [catalog,types]=await Promise.all([api<Catalog>('/catalog'),api<Kind[]>('/types?include_inactive=true')]);
    snapshot={...catalog,types};completed=version;lastSuccess=Date.now();for(const listener of listeners)listener();
  }while(completed!==requested);return snapshot;})().finally(()=>{pending=null;});
  return pending;
}
function reload(){requested++;void refreshCatalogue().catch(error=>window.dispatchEvent(new CustomEvent('smart-calc:catalog-error',{detail:errorMessage(error,'Не удалось обновить общую базу. Повторите действие.')})));}
function localMutation(){channel?.postMessage('changed');reload();}
function focus(){reload();}
function visibility(){if(document.visibilityState==='visible')reload();}
function subscribe(listener:()=>void){
  if(!listeners.size){
    if(typeof BroadcastChannel!=='undefined'){channel=new BroadcastChannel('smart-calc:catalogue');channel.onmessage=()=>reload();}
    window.addEventListener('smart-calc:catalog-mutated',localMutation);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',visibility);
  }
  listeners.add(listener);
  return()=>{listeners.delete(listener);if(!listeners.size){window.removeEventListener('smart-calc:catalog-mutated',localMutation);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',visibility);channel?.close();channel=null;}};
}
export default function useCatalogue(){return useSyncExternalStore(subscribe,()=>snapshot,()=>snapshot);}
