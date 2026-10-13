'use strict';
// Run with Playwright on NODE_PATH (or installed locally):
// node --test tests/dday.browser.test.cjs
// A localhost-only harness removes Firebase before delivery; production is never contacted.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
let chromium;
try { ({ chromium } = require('playwright')); } catch {}
const root = path.join(__dirname, '..');
const legacy = fs.readFileSync(path.join(root, 'data.json'));
const screenshotDir = process.env.DDAY_SCREENSHOT_DIR;

test('isolated Chromium UI: D-day persistence, JSON round-trip and 375/390/768/1440px bounds', {
    skip: !chromium && 'Playwright is required for browser verification', timeout: 120000
}, async () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
        .replace(/<script type="module">[\s\S]*?<\/script>/g, '<!-- Firebase disabled in this test server only. -->');
    assert(!html.includes('initializeApp(firebaseConfig)'));
    const core = fs.readFileSync(path.join(root, 'dashboard-core.js'));
    const server = http.createServer((request, response) => {
        response.setHeader('Content-Type', request.url === '/dashboard-core.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
        response.end(request.url === '/dashboard-core.js' ? core : html);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ headless: true, channel: process.env.DDAY_BROWSER_CHANNEL || 'msedge' });
        const url = 'http://127.0.0.1:' + server.address().port;
        if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });
        for (const width of [375, 390, 768, 1440]) {
            const context = await browser.newContext({ viewport: { width, height: width === 768 ? 1024 : 900 }, acceptDownloads: true });
            const page = await context.newPage(), errors = [], firebaseRequests = [];
            page.on('pageerror', error => errors.push(error.message));
            await context.route(/firebase|firestore|identitytoolkit|securetoken/, route => {
                firebaseRequests.push(route.request().url()); return route.abort();
            });
            await page.goto(url, { waitUntil: 'networkidle' });
            // Ensure this is the actual Tailwind layout, not a test fallback stylesheet.
            await page.waitForFunction(() => getComputedStyle(document.querySelector('#modal-overlay')).position === 'fixed');
            await page.locator('input[data-action="importData"]').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: legacy });
            await page.waitForFunction(() => window.getExportData().lectures.length === 86);
            const loaded = await page.evaluate(() => window.getExportData());
            await page.locator('[data-action="openDdayModal"]').click();
            await page.locator('#input-dday-title').fill('UI deadline ' + width);
            await page.locator('#input-dday-date').fill('2026-12-01');
            const layout = await page.evaluate(() => {
                const card = document.querySelector('.modal-card'), nodes = [
                    card, document.querySelector('#modal-body'), document.querySelector('.modal-actions'),
                    document.querySelector('#input-dday-title'), document.querySelector('#input-dday-date'),
                    ...document.querySelectorAll('.modal-actions > button')
                ];
                return nodes.map(node => {
                    const rect = node.getBoundingClientRect(), parent = node === card ? document.querySelector('#modal-overlay') : node.parentElement;
                    const bounds = parent.getBoundingClientRect();
                    return { name: node.id || node.className, left: rect.left, right: rect.right, width: rect.width,
                        parentLeft: bounds.left, parentRight: bounds.right, scroll: node.scrollWidth, client: node.clientWidth };
                });
            });
            assert(layout[0].width <= 512, width + 'px: preserve the existing modal maximum width');
            for (const item of layout) {
                assert(item.width > 0 && item.left >= item.parentLeft - 2 && item.right <= item.parentRight + 2, width + 'px bounds: ' + JSON.stringify(item));
                assert(item.scroll <= item.client + 2, width + 'px overflow: ' + JSON.stringify(item));
            }
            if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'dday-' + width + '.png') });
            await page.locator('#modal-save-btn').click();
            await page.locator('#modal-overlay').waitFor({ state: 'hidden' });
            let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('daon-dashboard-v2')));
            assert.equal(saved.data.ddays[0].title, 'UI deadline ' + width);
            assert.deepEqual(saved.data.courses, loaded.courses); assert.deepEqual(saved.data.lectures, loaded.lectures);
            assert.deepEqual(saved.data.dailyRecords, loaded.dailyRecords); assert.deepEqual(saved.data.memos, loaded.memos);
            await page.reload({ waitUntil: 'networkidle' });
            assert.equal(await page.locator('#view-ddays').getByText('UI deadline ' + width, { exact: true }).count(), 1);
            const downloading = page.waitForEvent('download');
            await page.locator('[data-action="exportData"]').click();
            const stream = await (await downloading).createReadStream(), chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const backup = Buffer.concat(chunks);
            assert.deepEqual(JSON.parse(backup.toString('utf8')).ddays, saved.data.ddays);
            await page.locator('[data-action="deleteDday"]').click();
            await page.reload({ waitUntil: 'networkidle' });
            assert.equal(await page.locator('[data-action="deleteDday"]').count(), 0);
            saved = await page.evaluate(() => JSON.parse(localStorage.getItem('daon-dashboard-v2')));
            assert.equal(saved.data.ddays.length, 0); assert.equal(saved.data._deletedDdayIds.length, 1);
            // Restore through the real import UI after deletion, then reload again.
            await page.locator('input[data-action="importData"]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
            await page.waitForFunction(() => window.getExportData().ddays.length === 1);
            await page.reload({ waitUntil: 'networkidle' });
            assert.deepEqual(await page.evaluate(() => window.getExportData()), JSON.parse(backup.toString('utf8')));
            assert.deepEqual(errors, []); assert.deepEqual(firebaseRequests, []);
            console.log(width + 'px: input/button bounds, add/reload, delete/reload, JSON restore/reload PASS');
            await context.close();
        }
        const context = await browser.newContext({ viewport: { width: 375, height: 900 } });
        const page = await context.newPage();
        await context.route(/firebase|firestore|identitytoolkit|securetoken/, route => route.abort());
        await page.goto(url, { waitUntil: 'networkidle' });
        await page.locator('[data-action="openDdayModal"]').click();
        await page.locator('#input-dday-title').fill('Keep failed input');
        await page.locator('#input-dday-date').fill('2026-12-02');
        await page.evaluate(() => {
            window.testSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function(key, value) {
                if (key === 'daon-dashboard-v2') throw new DOMException('Test quota', 'QuotaExceededError');
                return window.testSetItem.call(this, key, value);
            };
        });
        await page.locator('#modal-save-btn').click();
        await page.locator('#dday-save-error').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#input-dday-title').inputValue(), 'Keep failed input');
        assert.equal(await page.locator('#input-dday-date').inputValue(), '2026-12-02');
        assert.equal(await page.evaluate(() => window.getExportData().ddays.length), 0);
        await page.evaluate(() => { Storage.prototype.setItem = window.testSetItem; });
        await page.locator('#modal-save-btn').click();
        await page.reload({ waitUntil: 'networkidle' });
        assert.equal(await page.evaluate(() => window.getExportData().ddays.length), 1);
        console.log('375px: storage failure retains modal/input and successful retry persists once PASS');
        await context.close();
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
