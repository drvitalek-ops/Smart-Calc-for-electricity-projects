// Run with Playwright available in NODE_PATH and an isolated backend on port 8014.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const frontend = process.env.FRAME_TEST_FRONTEND || 'http://127.0.0.1:5174';
const backend = process.env.FRAME_TEST_BACKEND || 'http://127.0.0.1:8014';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.route('**/api/**', route => route.continue({ url: route.request().url().replace(frontend, backend) }));
    const api = context.request, base = backend + '/api';
    const project = await (await api.post(base + '/projects', { data: { name: 'Adaptive summary ' + Date.now() } })).json();
    const pid = project.id;
    const pages = await (await api.post(base + `/projects/${pid}/pdf`, { multipart: { file: { name: 'plan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('JVBERi0xLjcKJcK1wrYKJSBXcml0dGVuIGJ5IE11UERGIDEuMjguMgoKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFIvSW5mbzw8L1Byb2R1Y2VyKE11UERGIDEuMjguMik+Pj4+CmVuZG9iagoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0NvdW50IDEvS2lkc1s0IDAgUl0+PgplbmRvYmoKCjMgMCBvYmoKPDw+PgplbmRvYmoKCjQgMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94WzAgMCA1OTUgODQyXS9Sb3RhdGUgMC9SZXNvdXJjZXMgMyAwIFIvUGFyZW50IDIgMCBSPj4KZW5kb2JqCgp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwNDIgMDAwMDAgbiAKMDAwMDAwMDEyMCAwMDAwMCBuIAowMDAwMDAwMTcyIDAwMDAwIG4gCjAwMDAwMDAxOTMgMDAwMDAgbiAKCnRyYWlsZXIKPDwvU2l6ZSA1L1Jvb3QgMSAwIFIvSURbPEMyOUIyMEMyQjRDMkJDNTZDMzhBMkIxMjE4QzI4M0MyPjwxMUMwRDIyMDM3NzE0QkMxRjgyRDE0RDA3ODUxNUM1Mj5dPj4Kc3RhcnR4cmVmCjI4NAolJUVPRgo=', 'base64') } } })).json();
    const p = await (await api.get(base + `/projects/${pid}`)).json();
    const kinds = await (await api.get(base + '/types')).json();
    const rooms = [];
    for (const name of ['Кухня', 'Гостиная']) {
      rooms.push(await (await api.post(base + `/projects/${pid}/rooms`, { data: { name, wet: false } })).json());
    }
    for (const [room, name, quantity] of [[0, 'Zigbee диммер двухканальный', 2], [1, 'Zigbee диммер двухканальный', 3], [1, 'Люстра', 2], [1, 'Трек', 3.25], [0, 'Трек', 1.125], [0, 'LED-линия', 2.375], [1, 'LED-линия', 7.125]]) {
      const kind = kinds.find(item => item.name === name);
      const layer = p.layers.find(item => item.name === kind.category);
      const parameters = kind.unit === 'м' ? { length: quantity } : { quantity };
      const response = await api.post(base + `/projects/${pid}/elements`, { data: { page_id: pages[0].id, layer_id: layer.id, type_id: kind.id, room_id: rooms[room].id, x: .2, y: .3, parameters } });
      assert.equal(response.status(), 201);
    }
    const open = async () => {
      await page.goto(frontend);
      await page.getByLabel('Проект', { exact: true }).selectOption(String(pid));
      await page.getByRole('button', { name: 'Спецификация', exact: true }).click();
      await page.locator('.report-summary').waitFor();
    };
    await open();
    const overall = page.locator('.report-summary');
    const card = (scope, category) => scope.locator('.summary-category').filter({ has: page.getByRole('heading', { name: category, exact: true }) });
    const quantity = (scope, category, name) => card(scope, category).locator('p').filter({ has: page.getByText(name, { exact: true }) }).locator('strong').innerText();
    assert.equal(await overall.locator('.summary-category').count(), 3);
    assert.equal(await quantity(overall, 'Умные устройства', 'Zigbee диммер двухканальный'), '5 шт');
    assert.equal(await quantity(overall, 'LED-подсветка', 'LED-линия'), '9,5 м');
    const lighting = await card(overall, 'Освещение').locator('.summary-category-totals').innerText();
    assert.ok(lighting.includes('4,375 м') && lighting.includes('2 шт'));
    assert.ok(!(await overall.innerText()).includes('Электроустановки'));
    assert.ok(!(await overall.innerText()).includes('Рамки'));
    assert.equal(await page.locator('.room-summary').count(), 2);
    for (const [name, count] of [['Кухня', 2], ['Гостиная', 3]]) {
      const scope = page.locator('.room-summary').filter({ has: page.getByRole('heading', { name: 'Итог по помещению: ' + name, exact: true }) });
      assert.equal(await quantity(scope, 'Умные устройства', 'Zigbee диммер двухканальный'), `${count} шт`);
    }
    if (process.env.SUMMARY_SCREENSHOT) await page.screenshot({ path: process.env.SUMMARY_SCREENSHOT, fullPage: true });
    const smartLayer = p.layers.find(item => item.name === 'Умные устройства');
    await api.patch(base + `/layers/${smartLayer.id}`, { data: { export: false } });
    await open();
    assert.equal(await overall.locator('.summary-category').count(), 2);
    assert.ok(!(await overall.innerText()).includes('Умные устройства'));
    const empty = await (await api.post(base + '/projects', { data: { name: 'Empty summary ' + Date.now() } })).json();
    await page.reload();
    await page.getByLabel('Проект', { exact: true }).selectOption(String(empty.id));
    await page.getByRole('button', { name: 'Спецификация', exact: true }).click();
    await page.getByText('Добавьте элементы на план — ведомость заполнится автоматически.').waitFor();
    assert.equal(await page.locator('.report-summary').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: adaptive room and global summaries, smart devices, lights, strips, separate units, export exclusions and empty projects');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
