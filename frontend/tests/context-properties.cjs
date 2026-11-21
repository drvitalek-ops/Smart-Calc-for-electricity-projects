const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {blankPdf,checked,waitUntil}=require('./workbench-helpers.cjs');
const front=process.env.FRAME_TEST_FRONTEND||'http://127.0.0.1:5174',back=process.env.FRAME_TEST_BACKEND||'http://127.0.0.1:8014';
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox']});try{
 const context=await browser.newContext({viewport:{width:1366,height:768}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await context.route('**/api/**',route=>route.continue({url:route.request().url().replace(front,back)}));const api=context.request,base=back+'/api',types=await checked(await api.get(base+'/types')),point=types.find(t=>t.name==='Розетка одинарная'),line=types.find(t=>t.name==='LED-линия');
 const project=await checked(await api.post(base+'/projects',{data:{name:'Свойства из контекстного меню '+Date.now()}})),pid=project.id,pages=await checked(await api.post(base+`/projects/${pid}/pdf`,{multipart:{file:{name:'plan.pdf',mimeType:'application/pdf',buffer:blankPdf()}}})),plan=await checked(await api.get(base+`/projects/${pid}`));
 await checked(await api.post(base+'/pages/'+pages[0].id+'/calibrate',{data:{x1:.1,y1:.1,x2:.9,y2:.1,real_length_mm:8000}}));
 const items=[];for(const [index,kind] of [point,line].entries())items.push(await checked(await api.post(base+`/projects/${pid}/elements`,{data:{page_id:pages[0].id,layer_id:plan.layers.find(l=>l.name===kind.category).id,type_id:kind.id,x:.35,y:.35+index*.25,parameters:kind.unit==='м'?{length:2,manual_length:2}:{quantity:3},geometry:kind.unit==='м'?{points:[{x:.35,y:.6},{x:.65,y:.6}]}:{}}})));
 await page.goto(front);await page.getByLabel('Проект',{exact:true}).selectOption(String(pid));await page.locator('.sheet>svg').waitFor();const left=page.getByRole('complementary',{name:'Объекты и рамки'});
 async function editFromMenu(item,kind){
  await page.locator('[data-element-id="'+item.id+'"]').dispatchEvent('contextmenu',{button:2,clientX:700,clientY:350});const menu=page.locator('.object-context-menu');await menu.getByRole('button',{name:'Изменить свойства',exact:true}).click();
  assert.equal((await left.getAttribute('class')).includes('tool-closed'),false,'Context action must expand the left panel');assert.equal(await left.getAttribute('data-active-tool'),'properties');await menu.waitFor({state:'hidden'});
  const title=left.getByRole('button',{name:kind.name,exact:true});await title.waitFor();await waitUntil(async()=>await title.evaluate(node=>node===document.activeElement),'Focus moves to object properties');
  const inView=await title.evaluate(node=>{const a=node.getBoundingClientRect(),b=node.closest('.tool-panel-content').getBoundingClientRect();return a.top>=b.top&&a.bottom<=b.bottom;});assert.equal(inView,true,'Object heading is brought into view');
 }
 // The panel initially shows icons only, and the active tool is Objects.
 assert.equal((await left.getAttribute('class')).includes('tool-closed'),true);await editFromMenu(items[0],point);
 // An already open panel should switch sections and scroll back from the bottom.
 await left.getByRole('button',{name:'Инструмент: Оформление',exact:true}).click();await left.locator('.tool-panel-content').evaluate(node=>node.scrollTop=node.scrollHeight);await editFromMenu(items[1],line);
 // On a narrow workspace, open properties and reclaim space from the right panel.
 await page.setViewportSize({width:1000,height:700});await page.getByRole('button',{name:'Инструмент: Слои',exact:true}).click();assert.equal((await left.getAttribute('class')).includes('tool-closed'),true);await editFromMenu(items[0],point);assert.equal((await page.getByRole('complementary',{name:'Слои и страницы'}).getAttribute('class')).includes('tool-closed'),true);
 // The command also restores a panel removed by Focus on plan.
 await page.getByRole('button',{name:'Фокус на плане',exact:true}).click();assert.equal(await left.count(),0);await editFromMenu(items[1],line);
 const stored=await checked(await api.get(base+`/projects/${pid}`));assert.equal(stored.elements.find(e=>e.id===items[0].id).parameters.quantity,3);assert.equal(stored.elements.find(e=>e.id===items[1].id).parameters.length,2);assert.deepEqual(errors,[]);console.log('PASS: context properties expands collapsed left panel, switches tools, reveals/focuses point and line properties, closes compact right panel, restores focus mode panels and preserves quantities/metres');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
