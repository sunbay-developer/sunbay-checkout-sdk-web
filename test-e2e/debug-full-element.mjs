/**
 * Standalone Playwright debug script for the "pay -> no request -> upper layer timeout"
 * bug on http://localhost:8095/full-element.html.
 *
 * Headed on purpose so the user can watch. Captures:
 *  - console messages from EVERY frame (merchant 8095 / runtime 3000 / field iframes)
 *  - all network requests + responses (any origin)
 *  - postMessage traffic on the top window (SDK protocol envelopes)
 *  - the on-page event log (#log)
 *
 * Flow: open page -> "Create session & mount" -> fill combined card iframe with the
 * test card -> "Pay now" -> observe whether a payment/submit request fires on :3000.
 *
 * Run from test-e2e/:  node debug-full-element.mjs
 */
import { chromium } from '@playwright/test';

const MERCHANT = process.env.MERCHANT_URL ?? 'http://localhost:8095/full-element.html';
const CARD = {
    cardNumber: '4012000098765439',
    expiryMonth: '12',
    expiryYear: '2028',
    cvv: '999',
};

const ts = () => new Date().toISOString().slice(11, 23);
const line = (tag, ...rest) => console.log(`[${ts()}] ${tag}`, ...rest);

const browser = await chromium.launch({ headless: false, slowMo: 150 });
const context = await browser.newContext();
const page = await context.newPage();

// ---- console from every frame ----
page.on('console', (msg) => {
    const loc = msg.location();
    const where = loc?.url ? loc.url.replace(/^https?:\/\//, '') : '';
    line(`CONSOLE[${msg.type()}]`, msg.text(), where ? `(${where})` : '');
});
page.on('pageerror', (err) => line('PAGEERROR', err.message));
page.on('frameattached', (f) => line('FRAME+', f.url()));

// ---- network: requests + responses, any origin ----
const reqStart = new Map();
page.on('request', (req) => {
    reqStart.set(req, Date.now());
    const u = req.url();
    // Only surface API-ish traffic to keep the log readable (skip static assets).
    if (/\/(api|embed\/sdk|checkout|pay|submit|result|session)/i.test(u) || req.method() !== 'GET') {
        line(`REQ  ${req.method()}`, u, req.postData() ? `body=${(req.postData() || '').slice(0, 300)}` : '');
    }
});
page.on('requestfailed', (req) => {
    line('REQ-FAIL', req.method(), req.url(), req.failure()?.errorText);
});
page.on('response', async (res) => {
    const u = res.url();
    if (/\/(api|embed\/sdk|checkout|pay|submit|result|session)/i.test(u) || res.request().method() !== 'GET') {
        const dt = reqStart.has(res.request()) ? Date.now() - reqStart.get(res.request()) : '?';
        let bodyPreview = '';
        try {
            const ct = res.headers()['content-type'] ?? '';
            if (ct.includes('json') || ct.includes('text')) {
                bodyPreview = (await res.text()).slice(0, 300);
            }
        } catch {
            /* body not available */
        }
        line(`RES  ${res.status()}`, u, `(${dt}ms)`, bodyPreview ? `-> ${bodyPreview}` : '');
    }
});

// ---- postMessage traffic on the top window (SDK protocol) ----
await page.addInitScript(() => {
    const orig = window.addEventListener.bind(window);
    window.addEventListener('message', (e) => {
        try {
            const d = e.data;
            const kind = d && typeof d === 'object' ? d.type || d.kind || d.command || d.event || '(obj)' : String(d);
            // eslint-disable-next-line no-console
            console.log('[PM]', String(kind), JSON.stringify(d).slice(0, 400), 'from', e.origin);
        } catch {
            /* ignore */
        }
    });
    void orig;
});

line('GOTO', MERCHANT);
await page.goto(MERCHANT, { waitUntil: 'domcontentloaded' });

// 1) Create session & mount
line('CLICK', 'Create session & mount');
await page.click('#init');

// Wait until the pay button is enabled (meaning mount finished) or timeout.
try {
    await page.waitForSelector('#pay:not([disabled])', { timeout: 30_000 });
    line('STATE', 'pay button enabled (mount complete)');
} catch {
    line('STATE', 'pay button NOT enabled after 30s — mount may have failed');
}
line('STATUS', await page.locator('#status').textContent());

// 2) Fill the combined card iframe. full-element uses create('card') -> one iframe in #slot-card
//    containing number / expiry / cvc inputs (+ postal code since showPostalCode:true).
const cardFrame = page.frameLocator('#slot-card iframe');
async function fillByPlaceholderOrName(patterns, value) {
    for (const p of patterns) {
        const loc = cardFrame.locator(p);
        if ((await loc.count()) > 0) {
            await loc.first().click();
            await loc.first().fill(value);
            return p;
        }
    }
    return null;
}
try {
    // List inputs present in the card iframe for diagnosis.
    const inputInfo = await page.evaluate(() => {
        const f = document.querySelector('#slot-card iframe');
        return f ? { src: f.getAttribute('src') } : null;
    });
    line('CARD-IFRAME', JSON.stringify(inputInfo));

    const numSel = await fillByPlaceholderOrName(
        ['input[name*="number" i]', 'input[autocomplete="cc-number"]', 'input[placeholder*="1234" i]', 'input'],
        CARD.cardNumber
    );
    line('FILL number via', numSel);
    const expSel = await fillByPlaceholderOrName(
        ['input[name*="expiry" i]', 'input[autocomplete="cc-exp"]', 'input[placeholder*="MM" i]'],
        `${CARD.expiryMonth}${CARD.expiryYear.slice(2)}`
    );
    line('FILL expiry via', expSel);
    const cvcSel = await fillByPlaceholderOrName(
        ['input[name*="cvc" i]', 'input[name*="cvv" i]', 'input[autocomplete="cc-csc"]', 'input[placeholder*="CVC" i]'],
        CARD.cvv
    );
    line('FILL cvc via', cvcSel);
} catch (e) {
    line('FILL-ERROR', e.message);
}

// Give change events a moment.
await page.waitForTimeout(1500);

// 3) Pay now — this triggers checkout.confirm(). Watch for a submit/pay request on :3000.
line('CLICK', 'Pay now');
const netCountBefore = reqStart.size;
await page.click('#pay');

// Observe for up to 40s (confirm watchdog on the upper layer is ~30s).
line('WATCH', 'observing network/console for 40s after Pay...');
await page.waitForTimeout(40_000);

line('NET-DELTA', `${reqStart.size - netCountBefore} new requests captured after Pay`);
line('STATUS-FINAL', await page.locator('#status').textContent());

// Dump the on-page event log.
try {
    const logText = await page.locator('#log').textContent();
    line('PAGE-LOG', '\n' + (logText || '(empty)'));
} catch {
    /* ignore */
}

line('DONE', 'leaving browser open 20s for inspection');
await page.waitForTimeout(20_000);
await browser.close();
