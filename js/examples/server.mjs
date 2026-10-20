// @ts-nocheck
/**
 * 商户端到端 Demo 后端 server（模拟真实商户的服务端）。
 *
 * 职责（与真实商户后端一致）：
 *   1. 托管前端样板页（静态文件，本目录）——商户自己的页面，独立 origin；
 *   2. 暴露 `POST /api/create-session`：服务端持商户密钥调 Sunbay 开放平台
 *      `/v1/checkout/create-session` 下单，返回 sessionId 给前端。
 *
 * 为什么 session 必须在服务端创建：
 *   - 下单需要商户 API Key（Bearer），密钥**绝不能**下发到浏览器；
 *   - 浏览器直接跨域调开放平台会被 CORS 拦截。
 *   故由本 server 作为商户后端代为下单，前端只拿回 sessionId。
 *
 * 运行：Node 18+（内置 fetch），零外部依赖。
 *   node server.mjs
 * 配置（环境变量，均有 dev 默认值）：
 *   PORT            本 demo server 端口（默认 8080）
 *   OPEN_API_URL    Sunbay 开放平台地址（默认 https://open.sunbay-dev.com）
 *   API_KEY         商户 API Key（Bearer）
 *   APP_ID          商户 appId
 *   MERCHANT_ID     商户号
 *   CURRENCY        币种（默认 USD）
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
/**
 * 静态根设为 js（examples 的上级），使页面里的 `../dist/index.global.js`
 * （解析为 /dist/index.global.js）与 /examples/* 均可被服务。
 */
const STATIC_ROOT = join(__dirname, '..');

/** Demo 配置：从环境变量读取，带 dev 默认值。生产请改为真实商户凭据。 */
const CONFIG = {
    port: Number(process.env.PORT ?? 8080),
    openApiUrl: process.env.OPEN_API_URL ?? 'https://open.sunbay-dev.com',
    apiKey: process.env.API_KEY ?? 'btbrZjaplK3K7TreFjjpFVaK4dg6TcDn',
    appId: process.env.APP_ID ?? 'smz7g4g99uc8f5o4',
    merchantId: process.env.MERCHANT_ID ?? 'M1000000011',
    currency: process.env.CURRENCY ?? 'USD',
};

/** 静态文件扩展名 → Content-Type。 */
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.map': 'application/json; charset=utf-8',
};

/** 读取整个请求 body 为字符串。 */
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

/** 发送 JSON 响应。 */
function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
}

/**
 * 服务端下单：用商户参数调开放平台 create-session，返回 { sessionId, ... }。
 *
 * @param {{ items: {name:string,amount:number,num:number}[], description?: string, returnUrl?: string }} input
 * @returns {Promise<object>} 开放平台响应的 data（含 sessionId）
 */
async function createSession(input) {
    const items = Array.isArray(input.items) ? input.items : [];
    if (items.length === 0) {
        throw new Error('items 不能为空');
    }

    const orderAmount = items.reduce((sum, i) => sum + Number(i.amount) * Number(i.num), 0);
    const taxAmount = Math.round(orderAmount * 0.08);
    const now = Date.now();
    const requestId = `TXN${now}`;
    const orderId = `DEMO${now}`;
    const returnUrl = input.returnUrl ?? '';

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
        description: input.description ?? 'SDK demo order',
        productList: items,
        collectBillingAddress: true,
        collectShippingAddress: false,
        merchantReturnUrl: returnUrl,
        notifyUrl: returnUrl,
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
        const msg = data.msg || `上游下单失败（code=${data.code}）`;
        const err = new Error(msg);
        err.detail = data;
        throw err;
    }
    return data.data;
}

/** 处理静态文件请求（限定在 examples 目录内，防目录穿越）。 */
async function serveStatic(req, res) {
    let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (urlPath === '/') {
        urlPath = '/examples/merchant-demo.html';
    }
    // 归一化并限制在静态根内。
    const filePath = normalize(join(STATIC_ROOT, urlPath));
    if (!filePath.startsWith(STATIC_ROOT)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
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
        if (req.method === 'POST' && req.url === '/api/create-session') {
            const raw = await readBody(req);
            let input;
            try {
                input = raw ? JSON.parse(raw) : {};
            } catch {
                sendJson(res, 400, { error: '请求体非合法 JSON' });
                return;
            }
            try {
                const data = await createSession(input);
                sendJson(res, 200, { sessionId: data.sessionId, session: data });
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
            '  Sunbay Checkout SDK — 商户 Demo server 已启动',
            `  页面:      http://localhost:${CONFIG.port}/examples/merchant-demo.html`,
            `  下单接口:  POST http://localhost:${CONFIG.port}/api/create-session`,
            `  上游:      ${CONFIG.openApiUrl}/v1/checkout/create-session`,
            `  appId=${CONFIG.appId}  merchantId=${CONFIG.merchantId}  currency=${CONFIG.currency}`,
            '',
            '  提示：确保 checkout 托管页已在 http://localhost:3000 运行（npm run dev）。',
            '',
        ].join('\n')
    );
});
