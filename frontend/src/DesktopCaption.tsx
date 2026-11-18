import {ActionIcon} from './ToolRail';
type NativeWindow=Window&{chrome?:{webview?:{postMessage:(message:unknown)=>void}}};
export const isDesktop=()=>Boolean((window as NativeWindow).chrome?.webview);
export function desktopCommand(action:string){window.dispatchEvent(new Event('workspace-persist'));(window as NativeWindow).chrome?.webview?.postMessage({type:'window-control',action});}
export function captionPointer(event:React.PointerEvent<HTMLElement>){if(isDesktop()&&event.button===0&&event.clientY<event.currentTarget.getBoundingClientRect().top+40&&!(event.target as HTMLElement).closest('button,label,input,select,form,nav'))desktopCommand('drag');}
export function captionDoubleClick(event:React.MouseEvent<HTMLElement>){if(isDesktop()&&event.clientY<event.currentTarget.getBoundingClientRect().top+40&&!(event.target as HTMLElement).closest('button,label,input,select,form,nav'))desktopCommand('maximize');}
export default function DesktopCaption(){if(!isDesktop())return null;
  return <div className="desktop-caption" aria-label="Управление окном"><button aria-label="Свернуть окно" onClick={()=>desktopCommand('minimize')}>―</button><button aria-label="Развернуть или восстановить окно" onClick={()=>desktopCommand('maximize')}>□</button><button aria-label="Закрыть приложение" onClick={()=>desktopCommand('close')}><ActionIcon name="close"/></button></div>;
}
