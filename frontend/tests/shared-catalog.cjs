const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {blankPdf,checked,waitUntil}=require('./workbench-helpers.cjs');
const front=process.env.FRAME_TEST_FRONTEND||'http://127.0.0.1:5174',back=process.env.FRAME_TEST_BACKEND||'http://127.0.0.1:8014';
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox']});try{
 const context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',dialog=>dialog.accept());
 await context.route('**/api/**',route=>route.continue({url:route.request().url().replace(front,back)}));
 const api=context.request,base=back+'/api',stamp=Date.now(),brand='Новый производитель '+stamp,name='Светильник общий '+stamp,sku='SHARED-'+stamp;
 const types=await checked(await api.get(base+'/types')),kind=types.find(t=>t.name==='Встроенный светильник');
 await page.goto(front);await page.getByRole('button',{name:'Каталог и цены',exact:true}).click();const catalog=page.getByRole('dialog',{name:'Каталог оборудования',exact:true});await catalog.getByRole('button',{name:'Товары и цены',exact:true}).click();
 await catalog.getByLabel('Название',{exact:true}).fill(name);await catalog.getByLabel('Артикул',{exact:true}).fill(sku);await catalog.getByLabel('Тип',{exact:true}).selectOption(String(kind.id));
 await catalog.getByLabel('Производитель',{exact:true}).fill(brand);await catalog.getByRole('button',{name:'Добавить производителя «'+brand+'»',exact:true}).click();
 await waitUntil(async()=>(await checked(await api.get(base+'/catalog'))).manufacturers.some(m=>m.name===brand),'Manufacturer created directly in product editor');
 await catalog.getByLabel('Цена',{exact:true}).fill('100');await catalog.getByRole('button',{name:'Добавить товар',exact:true}).click();
 await waitUntil(async()=>await catalog.getByLabel('Название',{exact:true}).inputValue()==='','Product saved');
 let shared=await checked(await api.get(base+'/catalog')),product=shared.products.find(p=>p.sku===sku);assert.ok(product);const maker=shared.manufacturers.find(m=>m.id===product.manufacturer_id);
 // The common duplicate guard offers editing before adding another record.
 await catalog.getByLabel('Название',{exact:true}).fill(name+' вариант');await catalog.getByLabel('Артикул',{exact:true}).fill(sku.toLowerCase());await catalog.getByRole('button',{name:'Добавить товар',exact:true}).click();
 const warning=catalog.locator('.catalogue-duplicates');await warning.waitFor();assert.equal((await checked(await api.get(base+'/catalog'))).products.filter(p=>p.manufacturer_id===maker.id).length,1);
 await warning.getByRole('button',{name:'Редактировать выбранную позицию',exact:true}).click();assert.equal(await catalog.getByLabel('Название',{exact:true}).inputValue(),name);
 // A second window edits an existing quote while the catalogue changes.
 const created=await checked(await api.post(base+'/quotations',{data:{}})),qid=created.id,number='SHARED-'+qid;
 await checked(await api.put(base+'/quotations/'+qid,{data:{...created.quotation,number,lines:[{id:'shared-line',product_id:product.id,type_id:product.type_id,name:product.name,sku:product.sku,manufacturer:brand,quantity:'3',unit_price:'77.77',discount:'10',comment:'Согласованные условия'}]}}));
 const other=await context.newPage();other.on('pageerror',e=>errors.push(String(e)));other.on('dialog',dialog=>dialog.accept());await other.goto(front);await other.getByRole('button',{name:'Все КП',exact:true}).click();const hub=other.getByRole('region',{name:'Все коммерческие предложения',exact:true});await hub.getByLabel('Поиск КП',{exact:true}).fill(number);await hub.getByRole('button',{name:'Открыть КП '+number,exact:true}).click();
 const editor=other.getByRole('region',{name:'Редактор коммерческого предложения',exact:true});await editor.getByLabel('Цена строки 1',{exact:true}).fill('66.66');await editor.getByLabel('Артикул строки 1',{exact:true}).fill('QUOTE-ONLY');
 await catalog.getByLabel('Артикул',{exact:true}).fill('LOCAL-CARD');
 await other.getByRole('button',{name:'Каталог и цены',exact:true}).click();const secondCatalog=other.getByRole('dialog',{name:'Каталог оборудования',exact:true});await secondCatalog.getByRole('button',{name:'Товары и цены',exact:true}).click();await secondCatalog.locator('.product-list button[data-product-id]').filter({hasText:name}).click();
 await secondCatalog.getByLabel('Название',{exact:true}).fill(name+' обновлён');await secondCatalog.getByLabel('Артикул',{exact:true}).fill('NEW-'+stamp);await secondCatalog.getByLabel('Цена',{exact:true}).fill('600');await secondCatalog.getByRole('button',{name:'Сохранить изменения',exact:true}).click();await waitUntil(async()=>await secondCatalog.getByLabel('Название',{exact:true}).inputValue()==='','Second catalogue saved');
 await waitUntil(async()=>await catalog.getByLabel('Название',{exact:true}).inputValue()===name+' обновлён','An already open product editor receives unchanged fields');assert.equal(await catalog.getByLabel('Цена',{exact:true}).inputValue(),'600');assert.equal(await catalog.getByLabel('Артикул',{exact:true}).inputValue(),'LOCAL-CARD','Local card draft is preserved');await secondCatalog.getByRole('button',{name:'Закрыть каталог',exact:true}).click();
 await waitUntil(async()=>await editor.getByLabel('Наименование строки 1',{exact:true}).inputValue()===name+' обновлён','Other window receives catalogue metadata without losing quote draft',120);
 assert.equal(await editor.getByLabel('Артикул строки 1',{exact:true}).inputValue(),'QUOTE-ONLY');assert.equal(await editor.getByLabel('Цена строки 1',{exact:true}).inputValue(),'66.66');
 let stored=await checked(await api.get(base+'/quotations/'+qid));assert.equal(Number(stored.lines[0].unit_price),77.77);assert.equal(stored.lines[0].comment,'Согласованные условия');
 await editor.getByRole('button',{name:'Сохранить изменения КП',exact:true}).click();await waitUntil(async()=>Number((await checked(await api.get(base+'/quotations/'+qid))).lines[0].unit_price)===66.66,'Rebased quote saves without revision conflict');stored=await checked(await api.get(base+'/quotations/'+qid));assert.equal(Number(stored.lines[0].unit_price),66.66);assert.equal(stored.lines[0].sku,'QUOTE-ONLY');
 // The product created here is immediately usable by the plan calculator.
 const project=await checked(await api.post(base+'/projects',{data:{name:'Общая база '+stamp}})),pid=project.id;
 const sheets=await checked(await api.post(base+`/projects/${pid}/pdf`,{multipart:{file:{name:'plan.pdf',mimeType:'application/pdf',buffer:blankPdf()}}})),plan=await checked(await api.get(base+`/projects/${pid}`));
 const point=await checked(await api.post(base+`/projects/${pid}/elements`,{data:{page_id:sheets[0].id,layer_id:plan.layers.find(l=>l.name===kind.category).id,type_id:kind.id,product_id:product.id,x:.3,y:.3,parameters:{quantity:2},geometry:{}}}));
 const report=await checked(await api.get(base+`/projects/${pid}/report`));assert.equal(report.rows[0].sku,'NEW-'+stamp);assert.equal(Number(report.rows[0].unit_price),600);
 // Duplicate detection is also shared by the quote's new-product dialog.
 await editor.locator('[data-quote-line]').first().locator('summary').click();await editor.getByRole('button',{name:'＋ Товар в базу',exact:true}).click();const dialog=other.getByRole('dialog',{name:'Новый товар из КП',exact:true});await dialog.getByRole('button',{name:'Создать и привязать товар',exact:true}).click();await dialog.locator('.catalogue-duplicates').waitFor();
 await dialog.getByRole('button',{name:'Редактировать выбранную позицию',exact:true}).click();assert.equal(await dialog.getByLabel('Цена нового товара КП',{exact:true}).inputValue(),'600');await other.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 // Delete from one tool; other tools remove it from selection while snapshots survive.
 for(let i=0;i<30;i++)await checked(await api.post(base+'/manufacturers',{data:{name:'Справочник прокрутки '+stamp+' '+i}}));
 await catalog.getByText('Справочники и импорт CSV',{exact:true}).click();await catalog.getByRole('button',{name:'Удалить производителя '+brand,exact:true}).click();await waitUntil(async()=>(await checked(await api.get(base+'/catalog'))).manufacturers.find(m=>m.id===maker.id).active===false,'Manufacturer archived');
 await other.getByRole('button',{name:'Инструмент: Товары',exact:true}).click();await editor.getByLabel('Поиск товаров для КП',{exact:true}).fill('NEW-'+stamp);await waitUntil(async()=>await editor.locator('.quote-catalog-products article').count()===0,'Archive removed across windows');
 assert.equal((await checked(await api.get(base+`/projects/${pid}`))).elements.find(e=>e.id===point.id).product_id,product.id);assert.equal(Number((await checked(await api.get(base+'/quotations/'+qid))).lines[0].unit_price),66.66);
 await catalog.getByLabel('Показывать удалённые товары и производителей',{exact:true}).check();await catalog.getByRole('button',{name:'Восстановить производителя '+brand,exact:true}).click();await waitUntil(async()=>(await checked(await api.get(base+'/catalog'))).manufacturers.find(m=>m.id===maker.id).active===true,'Manufacturer restored explicitly');
 // A catalogue refresh must not bypass revision protection for a concurrent
 // financial edit made to the quotation in another window.
 await editor.getByRole('button',{name:'Редактировать',exact:true}).click();
 await editor.getByLabel('Артикул строки 1',{exact:true}).fill('LOCAL-CONFLICT');
 stored=await checked(await api.get(base+'/quotations/'+qid));
 await checked(await api.put(base+'/quotations/'+qid,{data:{...stored,lines:stored.lines.map(line=>({...line,unit_price:'333'}))}}));
 const refreshed=other.waitForResponse(response=>response.url()===base+'/quotations/'+qid&&response.request().method()==='GET');
 await other.evaluate(()=>window.dispatchEvent(new Event('smart-calc:catalog-mutated')));await refreshed;
 await editor.getByRole('button',{name:'Сохранить изменения КП',exact:true}).click();
 await editor.locator('.quote-error-summary').waitFor();
 assert.equal(Number((await checked(await api.get(base+'/quotations/'+qid))).lines[0].unit_price),333,'External price cannot be overwritten after a catalogue refresh');
 assert.deepEqual(errors,[]);console.log('PASS: inline manufacturer creation, shared duplicate review and edit, cross-window catalogue sync, preserved quote drafts/prices, plan binding and totals, archive/restore without lost references, concurrent quotation conflict protection');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
