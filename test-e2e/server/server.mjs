// @ts-nocheck
/**
 * Checkout Web SDK e2e test backend.
 *
 * Responsibilities (mirrors a real merchant backend; standalone origin):
 *   1. Serve the test harness page + the SDK IIFE build as static files.
 *   2. Expose `POST /api/create-session`: create a checkout session server-side
 *      using the SANDBOX merchant key (never sent to the browser), return a
 *      `sessionId`. Supports session variants (e.g. collectShippingAddress) for
 *      case C3-09.
 *   3. Expose `GET /healthz`: readiness probe (always 200) used by Playwright's
 *      webServer and by RUNNING.md checks. Reports whether credentials are present.
 *
 * When credentials are missing this server does NOT exit — it still serves
 * static files and /healthz, so credential-free tests (C1-02, error paths) can
 * run. Session-dependent requests return 503 with a clear message when
 * credentials are absent, and the Playwright layer skips
 * those tests (see support/env.ts).
 *
 * Node 20.6+ (built-in fetch + process.loadEnvFile), zero external deps.
 *   node server/server.mjs
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Repo-root-relative paths. server/ lives under test-e2e/. */
const TEST_E2E_ROOT = join(__dirname, '..');
const SDK_DIST = join(TEST_E2E_ROOT, '..', 'js', 'dist');
const HARNESS_DIR = join(TEST_E2E_ROOT, 'harness');

// Load sandbox credentials from test-e2e/.env.local (git-ignored). Missing file
// is tolerated: the server still serves static + healthz.
try {
    process.loadEnvFile(join(TEST_E2E_ROOT, '.env.local'));
} catch {
    // No .env.local: credential-free mode.
}

const CONFIG = {
    port: Number(process.env.PORT ?? 8090),
    openApiUrl: process.env.OPEN_API_URL ?? 'https://open.sunbay-dev.com',
    apiKey: process.env.API_KEY,
    appId: process.env.APP_ID,
    merchantId: process.env.MERCHANT_ID,
    currency: process.env.CURRENCY ?? 'USD',
};

/** True when all required sandbox credentials are present. */
const HAS_CREDENTIALS = Boolean(CONFIG.apiKey && CONFIG.appId && CONFIG.merchantId);

/** Static file extension → Content-Type. */
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.map': 'application/json; charset=utf-8',
};

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
}

/**
 * Create a checkout session via the open platform.
 *
 * @param {{ items?: {name:string,amount:number,num:number}[], description?: string,
 *           returnUrl?: string, collectBillingAddress?: boolean,
 *           collectShippingAddress?: boolean }} input
 * @returns {Promise<object>} open-platform response data (includes sessionId)
 */
async function createSession(input) {
    const items =
        Array.isArray(input.items) && input.items.length > 0
            ? input.items
            : [{ name: 'E2E Test Item', amount: 1000, num: 1 }];

    const orderAmount = items.reduce((sum, i) => sum + Number(i.amount) * Number(i.num), 0);
    const taxAmount = Math.round(orderAmount * 0.08);
    const now = Date.now();
    const requestId = `E2E${now}`;
    const orderId = `E2E${now}`;

    const payload = {
        appId: CONFIG.appId,
        transactionRequestId: requestId,
        referenceOrderId: orderId,
        merchantId: CONFIG.merchantId,
        amount: {
            orderAmount,
            taxAmount,
            priceCurrency: CONFIG.currency,
        },
        description: input.description ?? 'SDK e2e order',
        productList: items,
        // Session variants: default collect billing only; cases may override
        // (e.g. C3-09 requests collectShippingAddress:true).
        collectBillingAddress: input.collectBillingAddress ?? true,
        collectShippingAddress: input.collectShippingAddress ?? false,
        merchantReturnUrl: input.returnUrl ?? '',
        notifyUrl: input.returnUrl ?? '',
        sessionType: 'embedded',
    };

    const res = await fetch(`${CONFIG.openApiUrl}/v1/checkout/create-session`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${CONFIG.apiKey}`,
            'X-Client-Request-Id': requestId,
            'X-Timestamp': String(now),
        },
        body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (data.code !== '0' || !data.data?.sessionId) {
        const msg = data.msg || `upstream create-session failed (code=${data.code})`;
        const err = new Error(msg);
        err.detail = data;
        throw err;
    }
    return data.data;
}

/** Serve a static file from the allowed roots (harness/ or js/dist), prevent traversal. */
async function serveStatic(req, res) {
    let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (urlPath === '/' || urlPath === '/harness' || urlPath === '/harness/') {
        urlPath = '/harness/harness.html';
    }

    // Map /dist/* → js/dist/*, everything else → test-e2e/* (serves /harness/*).
    let filePath;
    if (urlPath.startsWith('/dist/')) {
        filePath = normalize(join(SDK_DIST, urlPath.slice('/dist/'.length)));
        if (!filePath.startsWith(SDK_DIST)) {
            sendJson(res, 403, { error: 'forbidden' });
            return;
        }
    } else {
        filePath = normalize(join(TEST_E2E_ROOT, urlPath));
        if (!filePath.startsWith(TEST_E2E_ROOT)) {
            sendJson(res, 403, { error: 'forbidden' });
            return;
        }
    }

    try {
        const content = await readFile(filePath);
        const type = MIME[extname(filePath)] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type });
        res.end(content);
    } catch {
        sendJson(res, 404, { error: 'not found', path: urlPath });
    }
}

const server = createServer(async (req, res) => {
    try {
        // Readiness probe — always 200; reports credential availability.
        if (req.method === 'GET' && req.url?.split('?')[0] === '/healthz') {
            sendJson(res, 200, {
                ok: true,
                hasCredentials: HAS_CREDENTIALS,
                hostedOrigin: process.env.E2E_HOSTED_ORIGIN ?? 'http://localhost:3000',
            });
            return;
        }

        if (req.method === 'POST' && req.url === '/api/create-session') {
            if (!HAS_CREDENTIALS) {
                sendJson(res, 503, {
                    error:
                        'Sandbox merchant credentials missing. Fill test-e2e/.env.local ' +
                        '(API_KEY/APP_ID/MERCHANT_ID). Session-dependent tests are skipped without them.',
                });
                return;
            }
            const raw = await readBody(req);
            let input;
            try {
                input = raw ? JSON.parse(raw) : {};
            } catch {
                sendJson(res, 400, { error: 'request body is not valid JSON' });
                return;
            }
            try {
                const data = await createSession(input);
                sendJson(res, 200, {
                    sessionId: data.sessionId,
                    checkoutClientSecret: data.checkoutClientSecret,
                    session: data,
                });
            } catch (err) {
                sendJson(res, 502, { error: err.message, detail: err.detail });
            }
            return;
        }

        if (req.method === 'GET') {
            await serveStatic(req, res);
            return;
        }

        sendJson(res, 405, { error: 'method not allowed' });
    } catch (err) {
        sendJson(res, 500, { error: err.message ?? 'internal error' });
    }
});

server.listen(CONFIG.port, () => {
    // eslint-disable-next-line no-console
    console.log(
        [
            '',
            '  Checkout SDK e2e test backend started',
            `  harness:  http://localhost:${CONFIG.port}/harness/harness.html`,
            `  healthz:  http://localhost:${CONFIG.port}/healthz`,
            `  session:  POST http://localhost:${CONFIG.port}/api/create-session`,
            `  sdk dist: http://localhost:${CONFIG.port}/dist/index.global.js`,
            `  credentials: ${HAS_CREDENTIALS ? 'present' : 'MISSING (credential-free mode)'}`,
            `  hint: ensure hosted runtime is running at ${process.env.E2E_HOSTED_ORIGIN ?? 'http://localhost:3000'}`,
            '',
        ].join('\n')
    );
});
