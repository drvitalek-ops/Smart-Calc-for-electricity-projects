const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {blankPdf,checked,waitUntil}=require('./workbench-helpers.cjs');
const frontend=process.env.FRAME_TEST_FRONTEND||'http://127.0.0.1:5174',backend=process.env.FRAME_TEST_BACKEND||'http://127.0.0.1:8014';
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox']}),directory=await fs.mkdtemp(path.join(os.tmpdir(),'sku-word-'));try{
 const context=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true}),page=await context.newPage(),errors=[],requests=[];
 await context.route('**/api/**',route=>route.continue({url:route.request().url().replace(frontend,backend)}));
 context.on('page',p=>p.on('pageerror',error=>errors.push(String(error))));page.on('pageerror',error=>errors.push(String(error)));
 page.on('request',request=>{if(request.url().endsWith('/sku.docx'))requests.push(request.postDataJSON());});
 const api=context.request,base=backend+'/api',created=await checked(await api.post(base+'/quotations',{data:{}})),qid=created.id,number='SKU-'+qid;
 const saved=await checked(await api.put(base+'/quotations/'+qid,{data:{...created.quotation,number,customer:'КЛИЕНТ_СЕКРЕТ',terms:'УСЛОВИЯ_СЕКРЕТ',lines:[{id:'second',name:'Лента','unit':'м',quantity:'3.5',unit_price:'98765.43',discount:'13.37',description:'ОПИСАНИЕ_СЕКРЕТ',comment:'КОММЕНТАРИЙ_СЕКРЕТ'},{id:'first',name:'Светильник',quantity:'1000',unit_price:'87654.32'}]}}));
 await page.goto(frontend);await page.getByRole('button',{name:'Все КП',exact:true}).click();const hub=page.getByRole('region',{name:'Все коммерческие предложения',exact:true});await hub.getByLabel('Поиск КП',{exact:true}).fill(number);await hub.getByRole('button',{name:'Открыть КП '+number,exact:true}).click();
 const editor=p=>p.getByRole('region',{name:'Редактор коммерческого предложения',exact:true}),button=p=>editor(p).getByRole('toolbar',{name:'Действия с позициями КП',exact:true}).getByRole('button',{name:'Сделать SKU',exact:true});
 async function download(p,label){const waiting=p.waitForEvent('download');await button(p).click();const file=await waiting;assert.ok(file.suggestedFilename().endsWith('.docx'));const target=path.join(directory,label+'.docx');await file.saveAs(target);const text=execFileSync('python3',['-c',`import sys,zipfile,xml.etree.ElementTree as ET
with zipfile.ZipFile(sys.argv[1]) as z:
 root=ET.fromstring(z.read('word/document.xml'))
 print('\\n'.join(e.text or '' for e in root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t')))
`,target],{encoding:'utf8'});return text;}
 await editor(page).getByLabel('Количество строки 1',{exact:true}).waitFor();await editor(page).getByLabel('Наименование строки 1',{exact:true}).fill('Имя из черновика');await editor(page).getByLabel('Количество строки 1',{exact:true}).fill('2,5');await editor(page).getByLabel('Цена строки 1',{exact:true}).fill('');
 await editor(page).getByLabel('Поиск позиций КП',{exact:true}).fill('Имя из черновика');
 await editor(page).getByLabel('Бренд строки 1',{exact:true}).fill('Бренд из черновика');
 const text=await download(page,'draft');assert.ok(text.includes('Бренд из черновика'));assert.ok(text.includes('Имя из черновика')&&text.includes('2,5')&&text.includes('1000'));assert.ok(text.indexOf('Имя из черновика')<text.indexOf('Светильник'));
 for(const privateText of ['98765','87654','13.37','КЛИЕНТ_СЕКРЕТ','УСЛОВИЯ_СЕКРЕТ','ОПИСАНИЕ_СЕКРЕТ','КОММЕНТАРИЙ_СЕКРЕТ','Цена','Сумма','Скидка','₽'])assert.ok(!text.includes(privateText),privateText);
 const payload=JSON.stringify(requests[0]);assert.ok(!/unit_price|discount|description|comment|image|98765/.test(payload));
 assert.deepEqual(await checked(await api.get(base+'/quotations/'+qid)),saved,'Export must not save or replace the quote');assert.equal(await editor(page).getByLabel('Цена строки 1',{exact:true}).inputValue(),'');
 await editor(page).getByLabel('Количество строки 1',{exact:true}).fill('');const before=requests.length;await button(page).click();await waitUntil(async()=>await editor(page).getByRole('alert').filter({hasText:'Количество'}).count()>0,'Invalid quantity must stay Russian');assert.equal(requests.length,before);
 await page.setViewportSize({width:1024,height:768});const box=await button(page).boundingBox();assert.ok(box.x>=0&&box.x+box.width<=1024&&box.y+box.height<=768,'SKU must stay visible in the pinned controls');
 // The project export resolves plan quantities while retaining the editor's name and explicit overrides.
 const project=await checked(await api.post(base+'/projects',{data:{name:'SKU project'}})),pid=project.id;
 const pages=await checked(await api.post(base+`/projects/${pid}/pdf`,{multipart:{file:{name:'plan.pdf',mimeType:'application/pdf',buffer:blankPdf()}}}));
 const data=await checked(await api.get(base+`/projects/${pid}`)),types=await checked(await api.get(base+'/types')),kind=types.find(kind=>kind.name==='LED-линия');
 const body={page_id:pages[0].id,layer_id:data.layers.find(layer=>layer.name==='LED-подсветка').id,type_id:kind.id,x:.3,y:.3,parameters:{length:3.5,ip:20}};
 const item=await checked(await api.post(base+`/projects/${pid}/elements`,{data:body})),p=await context.newPage();await p.goto(frontend);await p.getByLabel('Проект',{exact:true}).selectOption(String(pid));await p.getByRole('button',{name:'КП',exact:true}).click();await editor(p).getByLabel('Количество строки 1',{exact:true}).waitFor();
 await checked(await api.put(base+'/elements/'+item.id,{data:{...body,parameters:{length:8,ip:20}}}));let actual=await download(p,'plan');assert.ok(actual.includes('\n8\nм'));
 await editor(p).getByLabel('Ручное количество строки 1',{exact:true}).check();await editor(p).getByLabel('Количество строки 1',{exact:true}).fill('12,75');actual=await download(p,'manual');assert.ok(actual.includes('\n12,75\nм'));
 assert.deepEqual(errors,[]);console.log('PASS: Word SKU from unsaved rows with incomplete prices, no financial/extra data or quote writes, Russian invalid-quantity handling, pinned narrow controls, current plan counts and explicit manual override');
}finally{await browser.close();await fs.rm(directory,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
