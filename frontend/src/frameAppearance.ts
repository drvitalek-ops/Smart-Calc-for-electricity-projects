import palette from '../../backend/app/assets/frame-colors.json';
export function framePlanColor(parameters:Record<string,unknown>,productColor:unknown=''){
 const explicit=String(parameters.frame_plan_color??'');if(/^#[0-9a-f]{6}$/i.test(explicit))return explicit.toLowerCase();
 const value=String(parameters.frame_color||productColor||'').trim().toLowerCase().replaceAll('ё','е').replace(/\s+/g,' ');
 if(/^#[0-9a-f]{6}$/i.test(value))return value;
 return Object.entries(palette.colors).find(([name])=>value===name||value.startsWith(name+' '))?.[1]??palette.default;
}
export function frameContrast(color:string){const values=[1,3,5].map(index=>parseInt(color.slice(index,index+2),16));return .2126*values[0]+.7152*values[1]+.0722*values[2]>190?'#64748b':'#ffffff';}
