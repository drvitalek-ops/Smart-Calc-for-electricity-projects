// Isolated functional checks for camera anchoring, CAD geometry and close guards.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {blankPdf,checked,tool,waitUntil}=require('./workbench-helpers.cjs');
const frontend=process.env.FRAME_TEST_FRONTEND||'http://127.0.0.1:5174',backend=process.env.FRAME_TEST_BACKEND||'http://127.0.0.1:8014';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.addInitScript(()=>{window.__nativeStates=[];window.chrome=window.chrome||{};window.chrome.webview={postMessage:state=>window.__nativeStates.push(state)};});
  await page.route('**/api/**',route=>route.continue({url:route.request().url().replace(frontend,backend)}));
  const api=context.request,base=backend+'/api';
  const project=await checked(await api.post(base+'/projects',{data:{name:'CAD workbench '+Date.now()}})),pid=project.id;
  const pages=await checked(await api.post(base+`/projects/${pid}/pdf`,{multipart:{file:{name:'plan.pdf',mimeType:'application/pdf',buffer:blankPdf(1000,700)}}}));
  await checked(await api.patch(base+`/pages/${pages[0].id}`,{data:{scale:.7,offset_x:.1,offset_y:.08}}));
  await checked(await api.post(base+`/pages/${pages[0].id}/calibrate`,{data:{x1:.1,y1:.1,x2:.6,y2:.1,real_length_mm:5000}}));
  const data=await checked(await api.get(base+`/projects/${pid}`)),types=await checked(await api.get(base+'/types'));
  const socket=types.find(item=>item.name==='Розетка одинарная'),strip=types.find(item=>item.name==='LED-линия');
  const original=await checked(await api.post(base+`/projects/${pid}/elements`,{data:{page_id:pages[0].id,layer_id:data.layers.find(item=>item.name==='Электроустановки').id,type_id:socket.id,x:.3,y:.3,parameters:{quantity:1,ip:20},geometry:{}}}));
  await page.goto(frontend);await page.getByLabel('Проект',{exact:true}).selectOption(String(pid));
  const svg=page.locator('.sheet>svg'),sheet=page.locator('.sheet'),viewport=page.locator('.viewport');await svg.waitFor();
  // Correctly proportioned round symbols on a landscape plan.
  const symbol=await page.locator(`[data-element-id="${original.id}"] .editable-plan-symbol>g>circle`).boundingBox();
  assert.ok(Math.abs(symbol.width-symbol.height)<.5,'Circle distorted by sheet aspect ratio');
  // Keyboard and pointer use the same camera; no drift due to viewport padding.
  for(let i=0;i<4;i++)await page.getByRole('button',{name:'Увеличить план',exact:true}).click();
  await viewport.evaluate(node=>{node.scrollLeft=100;node.scrollTop=40;});
  const view=await viewport.boundingBox(),cursor={x:view.x+view.width*.55,y:view.y+view.height*.5};
  const before=await sheet.boundingBox(),anchor={x:(cursor.x-before.x)/before.width,y:(cursor.y-before.y)/before.height};
  await page.mouse.move(cursor.x,cursor.y);await page.keyboard.down('Control');await page.mouse.wheel(0,-200);await page.keyboard.up('Control');await page.waitForTimeout(150);
  const after=await sheet.boundingBox();assert.ok(Math.abs(after.x+anchor.x*after.width-cursor.x)<2,JSON.stringify({before,after,anchor,cursor}));assert.ok(Math.abs(after.y+anchor.y*after.height-cursor.y)<2,JSON.stringify({before,after,anchor,cursor}));
  await svg.focus();await page.keyboard.press('Control+0');await page.waitForTimeout(150);
  const fitted=await sheet.boundingBox(),available=await viewport.boundingBox();assert.ok(fitted.width<=available.width+1&&fitted.height<=available.height+1,'Fit must show the entire page');
  await page.getByRole('button',{name:'Сброс',exact:true}).click();await tool(page,'Объекты');
  await page.getByLabel('Тип элемента',{exact:true}).selectOption(String(strip.id));
  await page.getByRole('button',{name:'＋ Разместить элемент',exact:true}).click();
  await svg.focus();await page.keyboard.press('F3');await page.keyboard.press('F8');
  const rect=await svg.boundingBox(),display=p=>({x:(.5+(p.x-.5)*.7+.1)*rect.width,y:(.5+(p.y-.5)*.7+.08)*rect.height});
  const first=display({x:.3,y:.3});await svg.click({position:{x:first.x+3,y:first.y+2}});
  const second=display({x:.7,y:.34});await svg.click({position:second});
  assert.ok(await page.getByRole('button',{name:'✓ Узлов линии: 2',exact:true}).isVisible());
  await page.keyboard.press('Control+z');await page.getByRole('button',{name:'✓ Узлов линии: 1',exact:true}).waitFor();
  await page.keyboard.press('Control+Shift+z');await page.getByRole('button',{name:'✓ Узлов линии: 2',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__nativeStates.at(-1).dirty),true,'Unfinished line must be protected on EXE close');
  const createResponse=page.waitForResponse(response=>response.url().endsWith(`/projects/${pid}/elements`)&&response.request().method()==='POST');
  await page.keyboard.press('Enter');assert.equal((await createResponse).status(),201);await page.waitForTimeout(600);
  const current=await checked(await api.get(base+`/projects/${pid}`)),line=current.elements.find(item=>item.type_id===strip.id);
  assert.ok(line);assert.ok(Math.abs(line.geometry.points[0].x-.3)<.0001&&Math.abs(line.geometry.points[0].y-.3)<.0001,'F3 must snap to the existing source point');
  assert.ok(Math.abs(line.geometry.points[1].y-.3)<.0001,'Ortho must preserve the horizontal coordinate after an overlay transform');
  assert.ok(Math.abs(line.parameters.length-4)<.025,'Source geometry and millimetre calibration must agree');
  await svg.focus();await page.keyboard.press('Escape');await page.keyboard.press('Control+z');
  await waitUntil(async()=>!(await checked(await api.get(base+`/projects/${pid}`))).elements.some(item=>item.id===line.id),'Undo line');
  await page.keyboard.press('Control+Shift+z');await waitUntil(async()=>(await checked(await api.get(base+`/projects/${pid}`))).elements.some(item=>item.id===line.id),'Redo line');
  // A dirty property edit enters the same undo/redo history before autosave.
  await page.locator(`[data-element-id="${original.id}"] .point-symbol`).click();await tool(page,'Свойства');
  await page.getByLabel('Комментарий',{exact:true}).fill('Quick undo/redo');await svg.focus();await page.keyboard.press('Control+z');
  await waitUntil(async()=>(await checked(await api.get(base+`/projects/${pid}`))).elements.find(item=>item.id===original.id)?.comment!=='Quick undo/redo','Undo pending property');
  await page.waitForTimeout(250);await page.keyboard.press('Control+Shift+z');
  await waitUntil(async()=>(await checked(await api.get(base+`/projects/${pid}`))).elements.find(item=>item.id===original.id)?.comment==='Quick undo/redo','Redo pending property');
  await page.getByRole('button',{name:'Каталог и цены',exact:true}).first().click();
  const catalog=page.getByRole('dialog',{name:'Каталог оборудования',exact:true});
  await catalog.getByLabel('Название номенклатуры',{exact:true}).fill('Unfinished custom type');
  await catalog.getByRole('button',{name:'Категории',exact:true}).click();await catalog.getByLabel('Название категории',{exact:true}).fill('Unfinished category');
  await catalog.getByRole('button',{name:'Номенклатура',exact:true}).click();assert.equal(await catalog.getByLabel('Название номенклатуры',{exact:true}).inputValue(),'Unfinished custom type');
  assert.equal(await page.evaluate(()=>window.__nativeStates.at(-1).dirty),true);
  page.once('dialog',dialog=>dialog.dismiss());await catalog.getByRole('button',{name:'Закрыть каталог',exact:true}).click();assert.ok(await catalog.isVisible());
  page.once('dialog',dialog=>dialog.accept());await catalog.getByRole('button',{name:'Закрыть каталог',exact:true}).click();await catalog.waitFor({state:'hidden'});
  await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.__nativeStates.at(-1).dirty),false);
  assert.deepEqual(errors,[]);console.log('PASS: camera cursor anchoring and fit, round symbols, source coordinates under transformed overlays, F3/F8, point and server undo/redo, immediate draft redo, native close guards and catalogue drafts');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
