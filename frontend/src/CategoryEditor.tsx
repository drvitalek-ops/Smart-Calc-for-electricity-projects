import {apiFetch,errorMessage} from "./errors";
import {useEffect,useState} from 'react';
export type Category={id:number|null;name:string;description:string;system:boolean;positions:number};
export default function CategoryEditor({categories,onChanged,onDirtyChange,onBusyChange}:{categories:Category[];onChanged:()=>Promise<void>;onDirtyChange?:(dirty:boolean)=>void;onBusyChange?:(busy:boolean)=>void}){
  const [form,setForm]=useState({id:0,name:'',description:''}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const original=categories.find(item=>item.id===form.id),dirty=form.name!==(original?.name??'')||form.description!==(original?.description??'');
  useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false);},[dirty,onDirtyChange]);
  useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false);},[busy,onBusyChange]);
  async function save(method:string,id?:number){setBusy(true);setError('');try{
    await apiFetch('/api/categories'+(id?'/'+id:''),{method,headers:{'Content-Type':'application/json'},body:method==='DELETE'?undefined:JSON.stringify({name:form.name,description:form.description})});
    await onChanged();setForm({id:0,name:'',description:''});
  }catch(e){setError(errorMessage(e,'Ошибка'));}finally{setBusy(false);}}
  return <section aria-label="Категории каталога"><h3>Категории</h3><p className="hint">Создайте любую категорию, затем выберите её при добавлении номенклатуры. Категории сохраняются и без позиций.</p>
    {error&&<p role="alert" className="catalog-error">{error}</p>}
    <form className="nomenclature-form" onSubmit={event=>{event.preventDefault();void save(form.id?'PUT':'POST',form.id||undefined);}}>
      <label>Название категории<input required aria-label="Название категории" maxLength={200} value={form.name} onChange={event=>setForm({...form,name:event.target.value})}/></label>
      <label>Описание категории<textarea aria-label="Описание категории" maxLength={1000} value={form.description} onChange={event=>setForm({...form,description:event.target.value})}/></label>
      <button disabled={busy}>{form.id?'Сохранить категорию':'Добавить категорию'}</button>{form.id>0&&<button type="button" onClick={()=>setForm({id:0,name:'',description:''})}>Отменить</button>}
    </form><div className="nomenclature-rows">{categories.map(category=><article key={category.name}><div><strong>{category.name}</strong><small>{category.description} · Позиций: {category.positions}{category.system?' · Системная':''}</small></div>
      {category.id&&!category.system&&<><button disabled={busy} aria-label={'Редактировать категорию '+category.name} onClick={()=>setForm({id:category.id!,name:category.name,description:category.description})}>Редактировать</button>
        {!category.positions&&<button disabled={busy} aria-label={'Удалить категорию '+category.name} onClick={()=>void save('DELETE',category.id!)}>Удалить</button>}</>}
    </article>)}</div>
  </section>;
}
