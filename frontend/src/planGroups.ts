import {defaultGlyph} from './planSymbols';
import type {Kind,Layer,Item} from './App';
export type PlanGroup={key:string;label:string};
export type LayerGroup=PlanGroup&{count:number;color:string};
const lighting:Record<string,string>={recessed:'Встраиваемые светильники',surface:'Накладные светильники',chandelier:'Люстры',sconce:'Бра',pendant:'Подвесные светильники',spot:'Споты',linear:'Линейные светильники',wall_washer:'Wall washer',lamp:'Прочие светильники'};
export function planGroup(kind:Kind):PlanGroup{
  if(kind.category==='Электроустановки')return {key:'electrical:'+(kind.group??kind.category),label:kind.group??kind.category};
  if(kind.category==='Освещение'){
    if(kind.unit==='м'&&kind.name.toLocaleLowerCase('ru').includes('трек'))return {key:'light:track',label:'Треки'};
    const glyph=defaultGlyph(kind);return {key:'light:'+glyph,label:lighting[glyph]??kind.name};
  }
  return kind.group&&kind.group!==kind.category?{key:'group:'+kind.group,label:kind.group}:{key:'type:'+kind.name,label:kind.name};
}
export function layerGroups(layers:Layer[],elements:Item[],types:Kind[],keys:ReadonlyMap<number,PlanGroup>):Map<number,LayerGroup[]>{
  const kinds=new Map(types.map(kind=>[kind.id,kind])),byLayer=new Map<number,Map<string,LayerGroup>>();
  for(const layer of layers){
    const map=new Map<string,LayerGroup>();byLayer.set(layer.id,map);
    for(const type of types){if(!type.active||(layer.seed_key&&type.category!==layer.seed_key))continue;const group=keys.get(type.id)!;if(!map.has(group.key))map.set(group.key,{...group,count:0,color:type.color});}
  }
  for(const item of elements){const type=kinds.get(item.type_id),group=keys.get(item.type_id),map=byLayer.get(item.layer_id);if(!type||!group||!map)continue;const value=map.get(group.key)??{...group,count:0,color:type.color};value.count++;map.set(group.key,value);}
  return new Map([...byLayer].map(([id,groups])=>[id,[...groups.values()]]));
}
export function displayedElement(item:Item,layers:ReadonlyMap<number,Layer>,keys:ReadonlyMap<number,PlanGroup>,hidden:ReadonlyMap<number,ReadonlySet<string>>){
  return Boolean(layers.get(item.layer_id)?.visible)&&!hidden.get(item.layer_id)?.has(keys.get(item.type_id)?.key??'');
}
