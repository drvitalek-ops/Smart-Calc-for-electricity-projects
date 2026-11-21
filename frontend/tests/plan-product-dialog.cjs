const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {blankPdf,checked,waitUntil}=require('./workbench-helpers.cjs');
const front=process.env.FRAME_TEST_FRONTEND||'http://127.0.0.1:5174',back=process.env.FRAME_TEST_BACKEND||'http://127.0.0.1:8014';
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox']});try{
 const context=await browser.newContext({viewport:{width:1366,height:768}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',dialog=>dialog.accept());
 const api=context.request,base=back+'/api',stamp=Date.now(),types=await checked(await api.get(base+'/types')),original=types.find(t=>t.name==='Встроенный светильник');
 const replacement=await checked(await api.post(base+'/types',{data:{name:'Накладной светильник формы '+stamp,category:'Освещение',unit:'шт',color:'#458bcb',defaults:{quantity:1}}}));
 const project=await checked(await api.post(base+'/projects',{data:{name:'Форма товара и автосохранение '+stamp}})),pid=project.id,pages=await checked(await api.post(base+`/projects/${pid}/pdf`,{multipart:{file:{name:'plan.pdf',mimeType:'application/pdf',buffer:blankPdf()}}})),plan=await checked(await api.get(base+`/projects/${pid}`)),layer=plan.layers.find(l=>l.name===original.category);
 await checked(await api.patch(base+'/layers/'+layer.id,{data:{hidden_groups:['light:surface']}}));
 const item=await checked(await api.post(base+`/projects/${pid}/elements`,{data:{page_id:pages[0].id,layer_id:layer.id,type_id:original.id,x:.3,y:.4,parameters:{quantity:2},geometry:{}}}));
 let releaseSave,saveStarted=false;const saving=new Promise(resolve=>releaseSave=resolve);
 await context.route('**/api/**',async route=>{if(route.request().url().endsWith('/elements/'+item.id)&&route.request().method()==='PUT'){saveStarted=true;await saving;}await route.continue({url:route.request().url().replace(front,back)});});
 await page.goto(front);await page.getByLabel('Проект',{exact:true}).selectOption(String(pid));await page.locator('.sheet>svg').waitFor();
 await page.getByRole('button',{name:'Инструмент: Список объектов',exact:true}).click();await page.getByRole('button',{name:new RegExp('Выбрать объект №'+item.id+' —')}).click();
 const left=page.getByRole('complementary',{name:'Объекты и рамки'}),dialog=page.getByRole('dialog',{name:'Новый товар с плана',exact:true});
 // Simulate the interval after a modal enters the DOM but before React's
 // parent dirty flag has propagated. Focus may already be on the window body.
 const undoRequests=[];page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/elements/undo'))undoRequests.push(request.url());});
 await page.evaluate(()=>{const modal=document.createElement('section');modal.id='pending-modal-test';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');document.body.append(modal);document.activeElement?.blur();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(undoRequests.length,0,'A visible modal must block plan undo before parent state propagation');
 assert.ok((await checked(await api.get(base+`/projects/${pid}`))).elements.some(e=>e.id===item.id));await page.locator('#pending-modal-test').evaluate(node=>node.remove());
 // First show that a normal physical click opens the form at laptop height.
 await left.getByRole('button',{name:'＋ Добавить товар в базу с плана',exact:true}).click();await dialog.waitFor();
 await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.press('Control+z');
 assert.ok((await checked(await api.get(base+`/projects/${pid}`))).elements.some(e=>e.id===item.id),'Plan undo must not run behind an open form');
 await dialog.getByRole('button',{name:'Отмена',exact:true}).click();
 await page.clock.install();
 await left.getByRole('button',{name:'Изменить номенклатуру',exact:true}).click();await left.getByLabel('Номенклатура объекта',{exact:true}).selectOption(String(replacement.id));
 await left.getByRole('button',{name:'＋ Добавить товар в базу с плана',exact:true}).click();await dialog.waitFor();
 await dialog.getByLabel('Название нового товара с плана',{exact:true}).fill('Карточка сохраняется '+stamp);
 await page.clock.runFor(1500);
 assert.equal(saveStarted,false,'A new autosave must pause while the product form is open');
 await dialog.waitFor({timeout:1500});assert.equal(await dialog.getByLabel('Название нового товара с плана',{exact:true}).inputValue(),'Карточка сохраняется '+stamp);
 // Cancel resumes the pending object save; moving into a hidden group then
 // clears selection as usual, without discarding the edited nomenclature.
 await dialog.getByRole('button',{name:'Отмена',exact:true}).click();
 await page.clock.runFor(700);await waitUntil(async()=>saveStarted,'Deferred object save started');releaseSave();
 await waitUntil(async()=>(await checked(await api.get(base+`/projects/${pid}`))).elements.find(e=>e.id===item.id).type_id===replacement.id,'Type change persisted');
 await waitUntil(async()=>await left.getByText('Выберите объект на плане, чтобы изменить параметры.',{exact:true}).isVisible(),'Hidden group clears selection');
 // Re-expose the object and fill a new card before a catalogue update.
 await checked(await api.patch(base+'/layers/'+layer.id,{data:{hidden_groups:['light:sconce']}}));
 await page.reload();await page.getByLabel('Проект',{exact:true}).selectOption(String(pid));await page.locator('.sheet>svg').waitFor();
 await page.getByRole('button',{name:'Инструмент: Список объектов',exact:true}).click();await page.getByRole('button',{name:new RegExp('Выбрать объект №'+item.id+' —')}).click();
 await left.getByRole('button',{name:'＋ Добавить товар в базу с плана',exact:true}).click();await dialog.waitFor();
 await dialog.getByLabel('Производитель нового товара с плана',{exact:true}).fill('Производитель '+stamp);
 await dialog.getByLabel('Название нового товара с плана',{exact:true}).fill('Надёжное добавление '+stamp);
 // An edit in another window can move the nomenclature to a hidden group.
 await checked(await api.put(base+'/types/'+replacement.id,{data:{...replacement,name:'Бра формы '+stamp}}));
 await page.evaluate(()=>window.dispatchEvent(new Event('smart-calc:catalog-mutated')));
 await waitUntil(async()=>await left.getByText('Выберите объект на плане, чтобы изменить параметры.',{exact:true}).isVisible(),'Catalogue refresh removes the selection');
 await dialog.waitFor({timeout:1500});
 assert.equal(await dialog.getByLabel('Название нового товара с плана',{exact:true}).inputValue(),'Надёжное добавление '+stamp);
 assert.equal(await dialog.getByLabel('Производитель нового товара с плана',{exact:true}).inputValue(),'Производитель '+stamp);
 await dialog.getByRole('button',{name:'Создать и назначить выбранным · 1',exact:true}).click();
 await waitUntil(async()=>await dialog.count()===0,'Card saved even when refresh removes selected objects');
 const stored=await checked(await api.get(base+`/projects/${pid}`)),linked=stored.elements.find(e=>e.id===item.id);assert.ok(linked.product_id);assert.equal(linked.parameters.quantity,2);assert.equal(linked.type_id,replacement.id);
 const catalog=await checked(await api.get(base+'/catalog'));assert.equal(catalog.products.find(p=>p.id===linked.product_id).name,'Надёжное добавление '+stamp);
 assert.deepEqual(errors,[]);console.log('PASS: direct add click, paused draft autosave, form draft retained, hidden-group refresh and successful catalogue creation/binding without lost quantities');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
