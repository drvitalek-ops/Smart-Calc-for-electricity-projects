import {useEffect,useState} from 'react';
/** Pages are rasterized from the export PDF itself, without a browser PDF plugin. */
export default function QuotationPreview({base,document,mode}:{base:string;document:unknown;mode:string}){
  const [url,setUrl]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true),[page,setPage]=useState(1),[pages,setPages]=useState(1);
  useEffect(()=>{setPage(1);},[base,document,mode]);
  useEffect(()=>{
    const controller=new AbortController();let objectUrl='';setLoading(true);setError('');setUrl('');
    const timer=setTimeout(async()=>{
      try {
        const response=await fetch('/api'+base+'/preview.png?mode='+mode+'&page='+page,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(document),signal:controller.signal});
        if(!response.ok){const result=await response.json();throw Error(typeof result.detail==='string'?result.detail:'Проверьте поля КП');}
        const blob=await response.blob();if(controller.signal.aborted)return;
        objectUrl=URL.createObjectURL(blob);setPages(Number(response.headers.get('X-Preview-Pages'))||1);setUrl(objectUrl);setLoading(false);
      }catch(e){if(!controller.signal.aborted){setError(e instanceof Error?e.message:'Не удалось открыть PDF');setLoading(false);}}
    },250);
    return()=>{clearTimeout(timer);controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[base,document,mode,page]);
  return <div className="quotation-paper quotation-pdf-preview" aria-label="Предпросмотр коммерческого предложения">
    <p>Предпросмотр PDF · {mode==='client'?'без скидок':'со скидками'}</p>
    <nav aria-label="Страницы предпросмотра КП"><button type="button" disabled={loading||page<=1} onClick={()=>setPage(page-1)}>Назад</button><span>Страница {page} из {pages}</span><button type="button" disabled={loading||page>=pages} onClick={()=>setPage(page+1)}>Далее</button></nav>
    {loading&&<p role="status">Подготовка PDF…</p>}{error&&<p role="alert">{error}</p>}
    {url&&<img className="quotation-pdf-page" alt={'Страница '+page+' PDF КП'} src={url}/>}
  </div>;
}
