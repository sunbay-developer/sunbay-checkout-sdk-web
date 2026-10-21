// @ts-nocheck
/** Load hosted /sdk/main directly and print console/errors (isolate hosted health). */
import { chromium } from '@playwright/test';
const HOSTED = process.env.E2E_HOSTED_ORIGIN ?? 'http://localhost:3000';
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
let helloSeen = false;
page.on('console', (m) => console.log(`[${ts()}] console(${m.type()}):`, m.text().slice(0, 200)));
page.on('pageerror', (e) => console.log(`[${ts()}] pageerror:`, e.message.slice(0, 160)));
await page.addInitScript(() => {
    window.addEventListener('message', (e) => {
        if (typeof e.data === 'string' && e.data.includes('"hello"')) {
            // eslint-disable-next-line no-console
            console.log('HELLO_BROADCAST:', e.data.slice(0, 120));
        }
    });
});
await page.goto(`${HOSTED}/sdk/main?checkoutId=diag`, { waitUntil: 'networkidle' }).catch((e) => console.log('goto err', e.message));
await page.waitForTimeout(4000);
await browser.close();
console.log(`[${ts()}] done`);
