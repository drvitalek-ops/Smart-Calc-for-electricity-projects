import type {Catalog,Kind,Project} from './App';
import type {WorkIssue} from './IssueBar';
import {isElectrical,isPowerSupply} from './planDomain';
type Finding=Omit<WorkIssue,'action'>&{targetId?:number;pageId?:number};
export function productIssues(catalog:Catalog):Finding[]{
 const result:Finding[]=[],seen=new Map<string,number>(),makers=new Map(catalog.manufacturers.map(m=>[m.id,m]));
 for(const item of catalog.products){if(!item.active)continue;const add=(group:string,detail:string)=>result.push({id:group+item.id,group,title:item.name,detail,targetId:item.id});
  if(!(Number(item.price)>0))add('Без цены','Укажите цену товара. При новом выборе в КП будет использована эта цена; существующие КП сохранят свои цены.');
  if(!item.parameters.image)add('Без фото','Добавьте фотографию товара из файла, буфера обмена или перетаскиванием.');
  if(!item.sku.trim())add('Без артикула','Заполните артикул, чтобы различать похожие модели.');
  if(makers.get(item.manufacturer_id)?.active===false)add('Производитель в архиве','Восстановите производителя или выберите действующего.');
  const key=item.manufacturer_id+'|'+(item.sku.trim()?item.sku.trim().toLocaleLowerCase():item.type_id+'|'+item.name.trim().toLocaleLowerCase());
  if(seen.has(key))add('Похожие товары','Совпадает производитель и артикул или название. Проверьте карточки перед дальнейшим использованием.');else seen.set(key,item.id);
 }return result;
}
export function planIssues(project:Project|null,types:Kind[],catalog:Catalog):Finding[]{
 if(!project)return [];const result:Finding[]=[],kinds=new Map(types.map(t=>[t.id,t])),products=new Map(catalog.products.map(p=>[p.id,p])),elements=new Map(project.elements.map(e=>[e.id,e]));
 for(const page of project.pages)if(!page.meters_per_point)result.push({id:'scale'+page.id,group:'Нет масштаба',title:page.name||'Лист '+page.number,detail:'Задайте калибровочный отрезок в миллиметрах, прежде чем измерять линии. Длина LED-ленты будет рассчитана в метрах.',pageId:page.id});
 for(const item of project.elements){const kind=kinds.get(item.type_id),product=products.get(item.product_id??0),title='№ '+item.id+' · '+(String(item.parameters.display_name||kind?.name||'Неизвестный объект'));
  const add=(group:string,detail:string)=>result.push({id:group+item.id,group,title,detail,targetId:item.id});
  if(!kind){add('Нет номенклатуры','Номенклатура объекта не найдена. Выберите действующую позицию.');continue;}
  if(item.product_id===null)add('Нет товара','Привяжите товар к объекту, чтобы использовать его артикул, фото и цену в спецификации и КП.');
  else if(!product)add('Товар не найден','Проверьте привязку объекта к общей базе товаров.');
  else {
   if(!product.active)add('Товар в архиве','Сохранённая привязка действует. Для нового выбора восстановите товар или назначьте другой.');
   if(!(product.price>0))add('Без цены','У привязанного товара не задана цена. Укажите её в каталоге; цены уже созданных КП сохранятся.');
   if(!product.parameters.image)add('Без фото','У привязанного товара нет изображения. Добавьте его в общей карточке товара.');
   if(!product.sku.trim())add('Без артикула','У привязанного товара не заполнен артикул. Откройте его карточку в каталоге.');
  }
  if(project.rooms.length&&!item.room_id)add('Без помещения','Назначьте помещение вручную или проверьте контур комнаты.');
  if(isElectrical(kind)&&!item.parameters.frame_group)add('Без рамки','При необходимости назначьте рамку. Светильники и LED-линии в рамки не включаются.');
  if(isPowerSupply(kind)){
   const ids=item.parameters.led_strip_ids as number[]|undefined;
   if(!ids?.length||ids.some(id=>!elements.has(id)))add('Привязка LED','Выберите LED-ленты, которые питает этот блок.');
   if(!item.parameters.power_watts)add('Без мощности','Мощность блока питания необязательна. При необходимости укажите её в ваттах.');
  }
 }return result;
}
