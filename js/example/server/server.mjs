// @ts-nocheck
/**
 * Checkout Web SDK example backend (session-mock server).
 *
 * This is a minimal, dependency-free merchant-backend simulator that lets you
 * try the published SDK (`@sunbay/checkout-sdk-js`) in a real browser against
 * the hosted runtime. It mirrors `test-e2e/server/server.mjs` but is scoped to
 * the interactive examples under `js/example/`.
 *
 * Responsibilities (mirrors a real merchant backend; standalone origin):
 *   1. Serve the example pages (`public/*`) and the SDK IIFE build
 *      (`js/dist/index.global.js`) as static files.
 *   2. Expose `POST /api/create-session`: create a checkout session server-side
 *      using the SANDBOX merchant key (never sent to the browser) and return a
 *      `sessionId`. The request body may carry session variants
 *      (collectBillingAddress / collectShippingAddress / items / currency) so the
 *      split-field + address example can request a shipping address.
 *   3. Expose `GET /healthz`: readiness probe (always 200) that reports whether
 *      credentials and the SDK build are present.
 *
 * When credentials are missing this server does NOT exit — it still serves the
 * static pages and `/healthz`, so you can inspect the UI. Session-dependent
 * requests then return 503 with a clear message.
 *
 * Node 20.6+ (built-in fetch + process.loadEnvFile), zero external deps:
 *   node server/server.mjs
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';

// Session creation (the "token" source) lives in its own standalone module so
// it can also be imported or run directly (node server/session.mjs). It loads
// example/.env.local itself, so no duplicate credential loading is needed here.
import { createSession, HAS_CREDENTIALS } from './session.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Paths relative to this file. server/ lives under js/example/. */
const EXAMPLE_ROOT = join(__dirname, '..');
const PUBLIC_DIR = join(EXAMPLE_ROOT, 'public');
/** js/dist (the SDK IIFE build the pages load). example/ → js/example, so ../../dist. */
const SDK_DIST = join(EXAMPLE_ROOT, '..', 'dist');

const CONFIG = {
    port: Number(process.env.PORT ?? 8095),
    hostedOrigin: process.env.HOSTED_ORIGIN ?? 'http://localhost:3000',
};

/** Static file extension → Content-Type. */
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.map': 'application/json; charset=utf-8',
    '.ico': 'image/x-icon',
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

/** Serve a static file from the allowed roots (public/ or js/dist), preventing path traversal. */
async function serveStatic(req, res) {
    let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (urlPath === '/') {
        urlPath = '/index.html';
    }

    // Map /dist/* → js/dist/*, everything else → example/public/*.
    let filePath;
    if (urlPath.startsWith('/dist/')) {
        filePath = normalize(join(SDK_DIST, urlPath.slice('/dist/'.length)));
        if (!filePath.startsWith(SDK_DIST)) {
            sendJson(res, 403, { error: 'forbidden' });
            return;
        }
    } else {
        filePath = normalize(join(PUBLIC_DIR, urlPath));
        if (!filePath.startsWith(PUBLIC_DIR)) {
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

/** Whether the SDK IIFE build exists (so /healthz can hint when it's missing). */
async function sdkBuildPresent() {
    try {
        await stat(join(SDK_DIST, 'index.global.js'));
        return true;
    } catch {
        return false;
    }
}

const server = createServer(async (req, res) => {
    try {
        // Readiness probe — always 200; reports credential + build availability.
        if (req.method === 'GET' && req.url?.split('?')[0] === '/healthz') {
            sendJson(res, 200, {
                ok: true,
                hasCredentials: HAS_CREDENTIALS,
                sdkBuildPresent: await sdkBuildPresent(),
                hostedOrigin: CONFIG.hostedOrigin,
            });
            return;
        }

        // Expose the hosted origin to the browser (the pages read it to point the SDK).
        if (req.method === 'GET' && req.url?.split('?')[0] === '/api/config') {
            sendJson(res, 200, { hostedOrigin: CONFIG.hostedOrigin });
            return;
        }

        if (req.method === 'POST' && req.url === '/api/create-session') {
            if (!HAS_CREDENTIALS) {
                sendJson(res, 503, {
                    error:
                        'Sandbox merchant credentials missing. Copy example/.env.example to ' +
                        'example/.env.local and fill in API_KEY / APP_ID / MERCHANT_ID. ' +
                        'The UI is still inspectable without them.',
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

server.listen(CONFIG.port, async () => {
    const buildOk = await sdkBuildPresent();
    // eslint-disable-next-line no-console
    console.log(
        [
            '',
            '  Checkout SDK example backend started',
            `  examples:  http://localhost:${CONFIG.port}/`,
            `  healthz:   http://localhost:${CONFIG.port}/healthz`,
            `  session:   POST http://localhost:${CONFIG.port}/api/create-session`,
            `  sdk dist:  http://localhost:${CONFIG.port}/dist/index.global.js`,
            `  credentials: ${HAS_CREDENTIALS ? 'present' : 'MISSING (UI-only mode)'}`,
            `  sdk build:   ${buildOk ? 'present' : 'MISSING — run: pnpm --filter @sunbay/checkout-sdk-js run build'}`,
            `  hosted runtime: ${CONFIG.hostedOrigin} (start the checkout repo npm run dev)`,
            '',
        ].join('\n')
    );
});
