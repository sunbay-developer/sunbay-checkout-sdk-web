// @ts-nocheck
/**
 * One-off handshake diagnostic (NOT part of the suite).
 * Headed browser; opens the harness, hooks all console + framenavigation + the
 * parent window's postMessages, then runs setup() and prints a timeline so we can
 * see whether /sdk/main loads, hydrates, and broadcasts hello.
 *
 *   node diag/handshake-diag.mjs
 */
import { chromium } from '@playwright/test';

const HARNESS = process.env.E2E_HARNESS_ORIGIN ?? 'http://localhost:8090';
const HOSTED = process.env.E2E_HOSTED_ORIGIN ?? 'http://localhost:3000';
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`;

const browser = await chromium.launch({ headless: false, slowMo: 0 });
const page = await browser.newPage();

page.on('console', (m) => console.log(`[${ts()}] console(${m.type()}):`, m.text()));
page.on('pageerror', (e) => console.log(`[${ts()}] pageerror:`, e.message));
page.on('frameattached', (f) => console.log(`[${ts()}] frameattached:`, f.url()));
page.on('framenavigated', (f) => console.log(`[${ts()}] framenavigated:`, f.url()));
page.on('requestfailed', (r) =>
    console.log(`[${ts()}] requestfailed:`, r.url(), r.failure()?.errorText)
);

await page.addInitScript((origin) => {
    window.E2E_HOSTED_ORIGIN = origin;
    // Tap every message the top window receives.
    window.addEventListener('message', (e) => {
        let kind = typeof e.data;
        let preview = '';
        try {
            preview = typeof e.data === 'string' ? e.data.slice(0, 120) : JSON.stringify(e.data).slice(0, 120);
        } catch {
            preview = '(unserializable)';
        }
        // eslint-disable-next-line no-console
        console.log(`PARENT_MSG origin=${e.origin} type=${kind} data=${preview}`);
    });
}, HOSTED);

console.log(`[${ts()}] goto harness`);
await page.goto(`${HARNESS}/harness/harness.html`);
await page.waitForFunction(() => window.__sunbayHarnessReady === true, { timeout: 15000 });
console.log(`[${ts()}] harness ready, calling setup`);

const result = await page.evaluate(() =>
    window.__sunbayHarness.setup({ session: 'auto', elements: [] })
);
console.log(`[${ts()}] setup result:`, JSON.stringify(result));

// Give a moment to observe, then dump iframes present.
const frames = page.frames().map((f) => f.url());
console.log(`[${ts()}] frames:`, JSON.stringify(frames, null, 2));

await page.waitForTimeout(3000);
await browser.close();
console.log(`[${ts()}] done`);
