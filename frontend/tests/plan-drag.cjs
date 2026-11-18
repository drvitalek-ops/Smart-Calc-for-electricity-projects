// Exercise the real SVG pointer path, including release before its next animation frame.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {blankPdf,checked,waitUntil,tool}=require('./workbench-helpers.cjs');
const frontend=process.env.FRAME_TEST_FRONTEND||'http://127.0.0.1:5174',backend=process.env.FRAME_TEST_BACKEND||'http://127.0.0.1:8014';
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox']});try{
 const context=await browser.newContext({viewport:{width:1600,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],writes=[];
 page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>{if(r.method()==='PUT'&&/\/elements\/\d+$/.test(r.url()))writes.push(r.url());});
 await page.addInitScript(()=>{window.__planRenders={};window.__nativeStates=[];window.chrome={webview:{postMessage:s=>window.__nativeStates.push(s)}};});
 // Instrument only the test browser's Vite responses, keeping counters out of shipped code.
 await page.route('**/src/{App,PlanScene}.tsx*',async route=>{
  const response=await route.fetch();let code=await response.text();
  const names=route.request().url().includes('/App.tsx')?['App']:['PlanScene','PlanObject'];
  for(const name of names){const pattern=new RegExp('function '+name+'\\d*\\([\\s\\S]*?\\)\\s*\\{');assert.ok(pattern.test(code),'Render counter target: '+name);code=code.replace(pattern,match=>match+`window.__planRenders['${name}']=(window.__planRenders['${name}']||0)+1;`+(name==='PlanObject'?`window.__planRenders['object:'+item.id]=(window.__planRenders['object:'+item.id]||0)+1;`:'' ));}
  await route.fulfill({response,body:code});
 });
 await page.route('**/api/**',r=>r.continue({url:r.request().url().replace(frontend,backend)}));
 const api=context.request,base=backend+'/api',get=async path=>checked(await api.get(base+path)),post=async(path,data)=>checked(await api.post(base+path,{data}));
 const project=await post('/projects',{name:'Drag preview '+Date.now()}),pid=project.id;
 const pages=await checked(await api.post(base+`/projects/${pid}/pdf`,{multipart:{file:{name:'plan.pdf',mimeType:'application/pdf',buffer:blankPdf()}}})),p=await get('/projects/'+pid),types=await get('/types'),socket=types.find(t=>t.name==='Розетка одинарная'),strip=types.find(t=>t.name==='LED-линия');
 await post(`/pages/${pages[0].id}/calibrate`,{x1:.1,y1:.1,x2:.6,y2:.1,real_length_mm:5000});
 const points=[];for(const [x,y]of [[.2,.2],[.4,.2],[.45,.2]])points.push(await post(`/projects/${pid}/elements`,{page_id:pages[0].id,layer_id:p.layers.find(l=>l.name==='Электроустановки').id,type_id:socket.id,x,y,parameters:{quantity:2,ip:20}}));
 await post(`/projects/${pid}/frames`,{element_ids:points.slice(1).map(e=>e.id),posts:2});
 const line=await post(`/projects/${pid}/elements`,{page_id:pages[0].id,layer_id:p.layers.find(l=>l.name==='LED-подсветка').id,type_id:strip.id,x:.12,y:.7,parameters:{ip:20},geometry:{points:[{x:.12,y:.7},{x:.3,y:.7}]}});
 let quote=await get(`/projects/${pid}/quotation`);quote.global_discount='10';for(const row of quote.lines)row.unit_price='100';await checked(await api.put(base+`/projects/${pid}/quotation`,{data:quote}));
 const initial=await get('/projects/'+pid),report=await get(`/projects/${pid}/report`),totals=(await get(`/projects/${pid}/quotation`)).partner.totals;
 await page.goto(frontend);await page.getByLabel('Проект',{exact:true}).selectOption(String(pid));const svg=page.locator('.sheet>svg');await svg.waitFor();
 async function ready(){await waitUntil(async()=>!await page.getByRole('button',{name:'Настройки',exact:true}).isDisabled(),'Save completes',200);}
 // Separate selection from drag by more than the application's 450 ms double-click window.
 async function select(id){await page.locator(`[data-element-id="${id}"] .point-symbol`).click();await page.waitForTimeout(500);}
 async function begin(point){const b=await svg.boundingBox();await page.mouse.move(b.x+point.x*b.width,b.y+point.y*b.height);await page.mouse.down();await waitUntil(()=>page.evaluate(()=>window.__nativeStates.at(-1)?.dirty===true),'Drag protects native close');}
 async function sample(x,y,end='pointerup'){await svg.evaluate((node,{x,y,end})=>{const r=node.getBoundingClientRect(),data={bubbles:true,pointerId:1,pointerType:'mouse',button:0,buttons:1,clientX:r.x+x*r.width,clientY:r.y+y*r.height};node.dispatchEvent(new PointerEvent('pointermove',data));if(end)node.dispatchEvent(new PointerEvent(end,{...data,buttons:0}));},{x,y,end});}
 async function state(){return get('/projects/'+pid);}
 async function undo(){await svg.focus();const response=page.waitForResponse(r=>r.url().endsWith('/elements/undo'));await page.keyboard.press('Control+z');assert.ok((await response).ok());await waitUntil(async()=>JSON.stringify((await state()).elements)===JSON.stringify(initial.elements),'Exact geometry after undo',200);await ready();}
 // The final pointer sample must be saved even when release occurs in the same JS task.
 await select(points[0].id);await begin(points[0]);
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.evaluate(()=>window.__planRenders={});await sample(.25,.22,null);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const renders=await page.evaluate(()=>window.__planRenders);assert.equal(renders.App||0,0,'Moving an object must not rerender App');assert.equal(renders.PlanScene||0,0,'Moving an object must not rerender the static scene');assert.ok(renders.PlanObject>0,'The moving object must render');
 const transform=await page.locator(`[data-element-id="${points[0].id}"]`).getAttribute('transform');assert.ok(Math.abs(Number(transform.match(/translate\(([^,]+)/)[1])-250)<2,'Preview follows the pointer');
 const count=writes.length,response=page.waitForResponse(r=>r.url().endsWith('/elements/'+points[0].id)&&r.request().method()==='PUT');await sample(.27,.24);assert.ok((await response).ok());await page.mouse.up();await ready();
 let moved=await state(),item=moved.elements.find(e=>e.id===points[0].id);assert.ok(Math.abs(item.x-.27)<.002&&Math.abs(item.y-.24)<.002);for(const e of moved.elements)if(e.id!==item.id)assert.deepEqual(e,initial.elements.find(i=>i.id===e.id));
 await page.waitForTimeout(700);assert.equal(writes.length-count,1,'One history write per drop');assert.deepEqual(await get(`/projects/${pid}/report`),report);assert.deepEqual((await get(`/projects/${pid}/quotation`)).partner.totals,totals);
 await undo();await svg.focus();const redo=page.waitForResponse(r=>r.url().endsWith('/elements/redo'));await page.keyboard.press('Control+Shift+z');assert.ok((await redo).ok());await waitUntil(async()=>Math.abs((await state()).elements.find(e=>e.id===item.id).x-.27)<.002,'Redo restores move');await ready();await undo();
 // Undo during a held drag flushes the preview and cancels its queued frame.
 await begin(points[0]);await sample(.29,.26,null);const heldUndo=page.waitForResponse(r=>r.url().endsWith('/elements/undo'));await svg.focus();await page.keyboard.press('Control+z');assert.ok((await heldUndo).ok());await page.mouse.up();await waitUntil(async()=>JSON.stringify((await state()).elements)===JSON.stringify(initial.elements),'Undo while dragging',200);await ready();
 // Line nodes use the same isolated preview and retain millimetre calibration.
 await svg.click({position:{x:(await svg.boundingBox()).width*.2,y:(await svg.boundingBox()).height*.7}});await page.waitForTimeout(500);
 const node=page.locator(`[data-element-id="${line.id}"] .line-node-hit`).last(),box=await node.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();const lineSave=page.waitForResponse(r=>r.url().endsWith('/elements/'+line.id)&&r.request().method()==='PUT');await sample(.34,.72);assert.ok((await lineSave).ok());await page.mouse.up();await ready();
 item=(await state()).elements.find(e=>e.id===line.id);assert.ok(Math.abs(item.geometry.points[1].x-.34)<.002);assert.ok(Math.abs(item.parameters.length-Math.hypot(2.2,.14))<.03);await undo();
 // The first node also moves the line anchor and preserves the opposite endpoint.
 const firstNode=page.locator(`[data-element-id="${line.id}"] .line-node-hit`).first(),firstBox=await firstNode.boundingBox();await page.mouse.move(firstBox.x+firstBox.width/2,firstBox.y+firstBox.height/2);await page.mouse.down();const anchorSave=page.waitForResponse(r=>r.url().endsWith('/elements/'+line.id)&&r.request().method()==='PUT');await sample(.16,.68);assert.ok((await anchorSave).ok());await page.mouse.up();await ready();item=(await state()).elements.find(e=>e.id===line.id);assert.ok(Math.abs(item.x-.16)<.002&&Math.abs(item.y-.68)<.002);assert.deepEqual(item.geometry.points[1],line.geometry.points[1]);await undo();
 // An unexpected capture loss must release the gesture and persist its latest position.
 await select(points[0].id);await begin(points[0]);const lostSave=page.waitForResponse(r=>r.url().endsWith('/elements/'+points[0].id)&&r.request().method()==='PUT');await sample(.26,.23,'lostpointercapture');assert.ok((await lostSave).ok());await page.mouse.up();await ready();await waitUntil(()=>page.evaluate(()=>window.__nativeStates.at(-1)?.dirty===false),'Capture loss clears native drag protection');await undo();
 // A pending property autosave must not run in the middle of a held gesture.
 await page.getByRole('button',{name:'Скрыть надписи',exact:true}).click();await select(points[0].id);await tool(page,'Свойства');await page.getByLabel('Комментарий',{exact:true}).fill('Pending before drag');await begin(points[0]);const heldWrites=writes.length;await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.evaluate(()=>window.__planRenders={});await sample(.26,.23,null);await page.waitForTimeout(750);assert.equal(writes.length,heldWrites,'No property autosave during drag');
 const saved=page.waitForResponse(r=>r.url().endsWith('/elements/'+points[0].id)&&r.request().method()==='PUT');await sample(.28,.25,'pointercancel');assert.ok((await saved).ok());await page.mouse.up();await ready();item=(await state()).elements.find(e=>e.id===points[0].id);assert.equal(item.comment,'Pending before drag');assert.ok(Math.abs(item.x-.28)<.002);const savedRenders=await page.evaluate(()=>window.__planRenders);for(const other of initial.elements)if(other.id!==points[0].id)assert.equal(savedRenders['object:'+other.id]||0,0,'Saving must not redraw unchanged objects');await undo();
 // Deleting during capture must clear native dirty state and keep undo available.
 await select(points[0].id);await begin(points[0]);await sample(.25,.23,null);const deletion=page.waitForResponse(r=>r.request().method()==='DELETE'&&r.url().endsWith('/elements/'+points[0].id));await svg.focus();await page.keyboard.press('Delete');assert.ok((await deletion).ok());await page.mouse.up();await ready();await waitUntil(()=>page.evaluate(()=>window.__nativeStates.at(-1)?.dirty===false),'Delete clears drag state');await undo();
 await page.reload();await page.getByLabel('Проект',{exact:true}).selectOption(String(pid));await svg.waitFor();assert.deepEqual((await state()).elements,initial.elements);assert.deepEqual(await get(`/projects/${pid}/report`),report);assert.deepEqual((await get(`/projects/${pid}/quotation`)).partner.totals,totals);assert.deepEqual(errors,[]);
 console.log('PASS: isolated App/scene renders, final pointer sample, single save, stationary objects/frames, point undo/redo, held-drag undo, calibrated line-node move, pending-autosave guard, cancel/delete, native close protection, quote totals and reload');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
