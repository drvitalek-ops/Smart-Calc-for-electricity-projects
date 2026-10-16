// Run against an isolated backend with Playwright available in NODE_PATH.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const frontend = process.env.FRAME_TEST_FRONTEND || 'http://127.0.0.1:5174';
const backend = process.env.FRAME_TEST_BACKEND || 'http://127.0.0.1:8014';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
    const page = await context.newPage(), errors = [], calibrationRequests = [], elementWrites = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith('/calibrate')) calibrationRequests.push(request.postDataJSON());
      if (request.method() === 'PUT' && request.url().includes('/elements/')) elementWrites.push(request.postDataJSON());
    });
    await page.route('**/api/**', route => route.continue({ url: route.request().url().replace(frontend, backend) }));
    const api = context.request, base = backend + '/api';
    const pid = (await (await api.post(base + '/projects', { data: { name: 'Millimeter calibration ' + Date.now() } })).json()).id;
    const sheets = await (await api.post(base + `/projects/${pid}/pdf`, { multipart: { file: { name: 'plan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('JVBERi0xLjcKJcK1wrYKJSBXcml0dGVuIGJ5IE11UERGIDEuMjguMgoKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFIvSW5mbzw8L1Byb2R1Y2VyKE11UERGIDEuMjguMik+Pj4+CmVuZG9iagoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0NvdW50IDEvS2lkc1s0IDAgUl0+PgplbmRvYmoKCjMgMCBvYmoKPDw+PgplbmRvYmoKCjQgMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94WzAgMCA1OTUgODQyXS9Sb3RhdGUgMC9SZXNvdXJjZXMgMyAwIFIvUGFyZW50IDIgMCBSPj4KZW5kb2JqCgp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwNDIgMDAwMDAgbiAKMDAwMDAwMDEyMCAwMDAwMCBuIAowMDAwMDAwMTcyIDAwMDAwIG4gCjAwMDAwMDAxOTMgMDAwMDAgbiAKCnRyYWlsZXIKPDwvU2l6ZSA1L1Jvb3QgMSAwIFIvSURbPEMyOUIyMEMyQjRDMkJDNTZDMzhBMkIxMjE4QzI4M0MyPjwxMUMwRDIyMDM3NzE0QkMxRjgyRDE0RDA3ODUxNUM1Mj5dPj4Kc3RhcnR4cmVmCjI4NAolJUVPRgo=', 'base64') } } })).json();
    const p = await (await api.get(base + `/projects/${pid}`)).json();
    const kind = (await (await api.get(base + '/types')).json()).find(item => item.name === 'LED-линия');
    assert.equal((await api.post(base + `/pages/${sheets[0].id}/calibrate`, { data: { x1: 0, y1: 0, x2: 1, y2: 0, real_length_m: 5 } })).status(), 200);
    const created = await api.post(base + `/projects/${pid}/elements`, { data: { page_id: sheets[0].id, layer_id: p.layers.find(item => item.name === 'LED-подсветка').id, type_id: kind.id, x: .1, y: .5, parameters: { ip: 65 }, geometry: { points: [{ x: .1, y: .5 }, { x: .9, y: .5 }] } } });
    assert.equal(created.status(), 201);
    assert.equal((await created.json()).parameters.length, 4);
    await page.goto(frontend);
    await page.getByLabel('Проект', { exact: true }).selectOption(String(pid));
    const svg = page.locator('.sheet > svg');
    await svg.waitFor();
    const rect = await svg.boundingBox();
    await svg.click({ position: { x: rect.width * .5, y: rect.height * .5 } });
    await page.locator('.selected-line-object').waitFor();
    const calibrate = async input => {
      await page.getByRole('button', { name: 'Масштаб, мм', exact: true }).click();
      await svg.click({ position: { x: rect.width * .1, y: rect.height * .2 } });
      const dialogHandled = new Promise(resolve => page.once('dialog', async dialog => {
        assert.ok(dialog.message().includes('мм'));
        await dialog.accept(input);
        resolve();
      }));
      const response = page.waitForResponse(response => response.url().endsWith('/calibrate') && response.request().method() === 'POST');
      await svg.click({ position: { x: rect.width * .9, y: rect.height * .2 } });
      await dialogHandled;
      assert.equal((await response).status(), 200);
      await page.getByRole('button', { name: 'Масштаб, мм', exact: true }).waitFor();
      await page.waitForTimeout(1100);
    };
    await calibrate('4 000,0');
    let updated = await (await api.get(base + `/projects/${pid}`)).json();
    assert.equal(updated.elements[0].parameters.length, 4, 'Equivalent mm calibration must retain the same metre length');
    await calibrate('2000');
    updated = await (await api.get(base + `/projects/${pid}`)).json();
    assert.equal(updated.elements[0].parameters.length, 2, 'Recalibration must update the existing strip');
    assert.equal(calibrationRequests.length, 2);
    assert.deepEqual(calibrationRequests.map(item => item.real_length_mm), [4000, 2000]);
    assert.ok(calibrationRequests.every(item => !('real_length_m' in item)));
    assert.equal(elementWrites.length, 0, 'Recalibration must synchronize the selected autosave draft');
    await page.getByRole('button', { name: 'Спецификация', exact: true }).click();
    const report = await (await api.get(base + `/projects/${pid}/report`)).json();
    assert.equal(report.rows[0].quantity, 2);
    assert.equal(report.rows[0].unit, 'м');
    assert.deepEqual(errors, []);
    console.log('PASS: mm calibration, decimal comma and spaces, preservation of old metre scales, immediate line recalculation and metre reports');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
