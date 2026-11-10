const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const frontend=process.env.FRAME_TEST_FRONTEND||'http://127.0.0.1:5174';
const backend=process.env.FRAME_TEST_BACKEND||'http://127.0.0.1:8014';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox']});
 try {
  const context=await browser.newContext({viewport:{width:1700,height:1200}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/api/**',route=>route.continue({url:route.request().url().replace(frontend,backend)}));
  const api=context.request,base=backend+'/api';
  const source=await(await api.post(base+'/quotations',{data:{}})).json();
  const sourceDoc={...source.quotation,number:'PDF-SOURCE-40',lines:[
   {id:'a',name:'Светильник LED IP54',sku:'L-001',quantity:'2',unit:'шт',unit_price:'25904.00',currency:'RUB',discount:'15'},
   {id:'b',name:'Лента 24V',sku:'LED-2',quantity:'2.5',unit:'м',unit_price:'1234.50',currency:'RUB'},
   {id:'c',name:'Лампочка E27',quantity:'27',unit:'шт',unit_price:'210.00',currency:'RUB'}]};
  assert.equal((await api.put(base+'/quotations/'+source.id,{data:sourceDoc})).status(),200);
  const pdf=await(await api.get(base+'/quotations/'+source.id+'/export.pdf?mode=partner')).body();
  const target=await(await api.post(base+'/quotations',{data:{}})).json();
  const number='PDF-IMPORT-'+target.id;
  assert.equal((await api.put(base+'/quotations/'+target.id,{data:{...target.quotation,number}})).status(),200);
  await page.goto(frontend);await page.getByRole('button',{name:'КП',exact:true}).click();
  const hub=page.getByRole('region',{name:'Все коммерческие предложения',exact:true});await hub.waitFor();
  await hub.getByRole('button',{name:'Открыть КП '+number,exact:true}).click();
  const editor=page.getByRole('region',{name:'Редактор коммерческого предложения',exact:true});await editor.getByLabel('Номер КП',{exact:true}).waitFor();
  await editor.getByLabel('Файл внешнего КП',{exact:true}).setInputFiles({name:'Поставщик.pdf',mimeType:'application/pdf',buffer:pdf});
  const dialog=page.getByRole('dialog',{name:'Проверка импорта КП',exact:true});await dialog.waitFor();
  await dialog.getByText('Суммы совпали с PDF: 3.',{exact:false}).waitFor();
  assert.equal(Number(await dialog.getByLabel('Импорт: скидка 1',{exact:true}).inputValue()),15);
  assert.equal(await dialog.getByLabel('Импорт: цена 1',{exact:true}).inputValue(),'25904.00');
  assert.equal(await dialog.getByLabel('Импорт: количество 2',{exact:true}).inputValue(),'2.500');
  assert.equal((await(await api.get(base+'/quotations/'+target.id)).json()).lines.length,0,'PDF upload is preview only');
  await dialog.getByLabel('Импорт: цена 1',{exact:true}).fill('25000');
  await dialog.getByText('Изменено вручную',{exact:true}).waitFor();
  await dialog.getByLabel('Импорт: артикул 1',{exact:true}).fill('CORRECTED-1');
  await dialog.getByLabel('Удалить импортированную строку 3',{exact:true}).click();
  await dialog.getByRole('button',{name:'Перенести позиции в КП',exact:true}).click();await dialog.waitFor({state:'detached'});
  const saved=page.waitForResponse(r=>r.url().endsWith('/quotations/'+target.id)&&r.request().method()==='PUT');
  await editor.getByRole('button',{name:'Сохранить КП',exact:true}).click();
  const doc=await(await saved).json();assert.equal(doc.lines.length,2);assert.equal(Number(doc.lines[0].unit_price),25000);assert.equal(doc.lines[0].sku,'CORRECTED-1');
  assert.equal(doc.partner.totals.RUB.total,'45586.25');
  // All imported rows must be accessible, including row 101, before confirmation.
  await page.route('**/api/quotations/'+target.id+'/import-file',route=>route.fulfill({json:{filename:'101.pdf',warnings:[],checks:[],lines:Array.from({length:101},(_,i)=>({...doc.lines[0],id:'bulk-'+i,name:'Товар '+(i+1)}))}}));
  await editor.getByLabel('Файл внешнего КП',{exact:true}).setInputFiles({name:'101.pdf',mimeType:'application/pdf',buffer:pdf});await dialog.waitFor();
  await dialog.getByRole('button',{name:'Далее',exact:true}).click();
  await dialog.getByLabel('Импорт: наименование 101',{exact:true}).fill('Последняя позиция');
  await dialog.getByLabel('Импорт: количество 101',{exact:true}).fill('0');
  await dialog.getByRole('button',{name:'Перенести позиции в КП',exact:true}).click();
  await dialog.getByRole('alert').filter({hasText:'строке 101'}).waitFor();
  await dialog.getByRole('button',{name:'Отмена',exact:true}).click();
  assert.equal((await(await api.get(base+'/quotations/'+target.id)).json()).lines.length,2);
  assert.deepEqual(errors,[]);await page.screenshot({path:process.env.PDF_IMPORT_SCREENSHOT||'/tmp/pdf-quotation-import.png',fullPage:true});
  console.log('PASS: real PDF prices, quantity, discount, arithmetic review, editing, removal, pagination and cancellation');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
