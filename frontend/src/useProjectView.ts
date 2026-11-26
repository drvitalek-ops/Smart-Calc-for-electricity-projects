import {useLayoutEffect,useRef,type RefObject} from 'react';
import {apiFetch} from './errors';
type Settings=Record<string,unknown>;
type Camera={zoom:number;x:number;y:number};
type Sync={sent:string;pending:string|null;timer:number;sending:boolean};
type Saved={version:1;lastPage?:number;settingsChangedAt?:number;settings:Settings;pages:Record<string,Camera>};
const key=(id:number)=>`smart-home-calc:project-view:v1:${id}`;
export function readProjectView(id:number):Saved{
  try{const value=JSON.parse(localStorage.getItem(key(id))??'null');if(value?.version===1&&value.settings&&typeof value.settings==='object'&&value.pages&&typeof value.pages==='object')return value;}catch{}
  return {version:1,settings:{},pages:{}};
}
function valid(camera:Camera|undefined){return camera&&Number.isFinite(camera.zoom)&&camera.zoom>=.1&&camera.zoom<=16&&Number.isFinite(camera.x)&&Number.isFinite(camera.y);}
/** Scroll samples stay in refs; saving a camera never renders the drawing. */
export default function useProjectView(props:{projectId:number|null;pageId:number|null;active:boolean;zoom:number;setZoom:(value:number)=>void;viewport:RefObject<HTMLDivElement|null>;sheet:RefObject<HTMLDivElement|null>;settings:Settings;initialSettings?:Settings;onSaveError:(message:string)=>void;restore:(value:Settings)=>void}){
  const latest=useRef(props);latest.current=props;
  const state=useRef<{project:number;page:number;saved:Saved;ready:boolean;sync:Sync}|null>(null);
  const timer=useRef(0),frame=useRef(0);
  function sample(){const current=state.current,p=latest.current;if(!current?.ready)return;
    const view=p.viewport.current,paper=p.sheet.current;
    // A cleanup can run after React replaced the sheet. Camera samples are stored on scroll/zoom.
    if(p.active&&p.projectId===current.project&&p.pageId===current.page&&view&&paper){const a=view.getBoundingClientRect(),b=paper.getBoundingClientRect();if(b.width&&b.height)current.saved.pages[String(current.page)]={zoom:p.zoom,x:(a.left+view.clientWidth/2-b.left)/b.width,y:(a.top+view.clientHeight/2-b.top)/b.height};if(JSON.stringify(current.saved.settings)!==JSON.stringify(p.settings)){current.saved.settings=p.settings;current.saved.settingsChangedAt=Math.max(Date.now(),(current.saved.settingsChangedAt??0)+1);}}
  }
  function send(current:NonNullable<typeof state.current>){
    const sync=current.sync;clearTimeout(sync.timer);
    if(sync.sending||sync.pending===null)return;
    const body=sync.pending;sync.pending=null;sync.sending=true;sync.sent=body;
    void apiFetch(`/api/projects/${current.project}/view-settings`,{method:'PATCH',headers:{'Content-Type':'application/json'},body,keepalive:true})
      .catch(()=>{if(latest.current.projectId===current.project)latest.current.onSaveError('Не удалось сохранить настройки отображения в проекте. Локальная копия сохранена; измените настройку повторно после восстановления связи.');})
      .finally(()=>{sync.sending=false;if(sync.pending!==null)send(current);});
  }
  function write(immediate=false){sample();const current=state.current;if(!current?.ready)return;
    try{localStorage.setItem(key(current.project),JSON.stringify(current.saved));}catch{}
    const body=JSON.stringify({...current.saved.settings,savedAt:current.saved.settingsChangedAt??0}),sync=current.sync;
    if(body!==sync.sent&&body!==sync.pending){sync.pending=body;clearTimeout(sync.timer);sync.timer=window.setTimeout(()=>send(current),400);}
    if(immediate)send(current);
  }
  useLayoutEffect(()=>{
    const {projectId,pageId,active}=props;if(!projectId||!pageId||!active){write();return;}
    const previous=state.current,changedProject=previous?.project!==projectId;
    if(previous?.project===projectId&&previous.page===pageId&&previous.ready)return;
    const saved=changedProject?readProjectView(projectId):previous!.saved;
    if(changedProject){
      const {savedAt,...remote}=props.initialSettings??{};
      // An immediate restart can interrupt the last network save. Prefer the
      // newest snapshot, including existing v69 caches without a timestamp.
      const localNewer=typeof saved.settingsChangedAt==='number'?saved.settingsChangedAt>=Number(savedAt??0):Object.keys(saved.settings).length>0;
      saved.settings=localNewer?{...remote,...saved.settings}:{...saved.settings,...remote};
      if(!localNewer&&typeof savedAt==='number')saved.settingsChangedAt=savedAt;
    }
    const sync=changedProject?{sent:JSON.stringify(props.initialSettings??{}),pending:null,timer:0,sending:false}:previous!.sync;
    state.current={project:projectId,page:pageId,saved,ready:false,sync};saved.lastPage=pageId;
    if(changedProject)props.restore({symbolScale:props.settings.symbolScale,labelsVisible:true,roomLabelsVisible:true,showRoomContours:true,elementsVisible:true,objectSnap:false,ortho:false,adaptiveLabels:true,showGrid:true,roomSnap:true,elementLayersExpanded:false,highlightUnframed:false,leftExpanded:false,rightExpanded:false,leftTool:'objects',rightTool:'layers',...saved.settings});
    const camera=saved.pages[String(pageId)];
    props.setZoom(valid(camera)?camera.zoom:1);
    frame.current=requestAnimationFrame(()=>{const view=props.viewport.current,paper=props.sheet.current;
      if(view&&paper){if(valid(camera)){const a=view.getBoundingClientRect(),b=paper.getBoundingClientRect();view.scrollLeft+=b.left+camera.x*b.width-a.left-view.clientWidth/2;view.scrollTop+=b.top+camera.y*b.height-a.top-view.clientHeight/2;}else{view.scrollLeft=Math.max(0,(view.scrollWidth-view.clientWidth)/2);view.scrollTop=Math.max(0,(view.scrollHeight-view.clientHeight)/2);}}
      if(state.current){state.current.ready=true;write();}
    });
    return()=>{cancelAnimationFrame(frame.current);clearTimeout(timer.current);write(true);};
  },[props.projectId,props.pageId,props.active]);
  useLayoutEffect(()=>{if(state.current?.ready){write();}},[props.zoom,props.settings]);
  useLayoutEffect(()=>{const view=props.viewport.current;if(!props.active||!view)return;
    const scroll=()=>{sample();clearTimeout(timer.current);timer.current=window.setTimeout(write,120);};
    const flush=()=>write(true);
    view.addEventListener('scroll',scroll,{passive:true});window.addEventListener('pagehide',flush);window.addEventListener('workspace-persist',flush);
    return()=>{clearTimeout(timer.current);view.removeEventListener('scroll',scroll);window.removeEventListener('pagehide',flush);window.removeEventListener('workspace-persist',flush);write(true);};
  },[props.projectId,props.pageId,props.active]);
}
