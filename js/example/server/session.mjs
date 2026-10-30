// @ts-nocheck
/**
 * Standalone checkout-session helper.
 *
 * Creates a checkout session via the open platform using the SANDBOX merchant
 * key held on the server and returns the session data (which includes the
 * `sessionId` — the "token" the browser SDK consumes). This module is
 * dependency-free and can be used two ways:
 *
 *   1. Imported:  `import { createSession, getToken } from './session.mjs'`
 *   2. Run directly to print a token:
 *        node server/session.mjs
 *        node server/session.mjs 9.99          # override amount (major units)
 *        node server/session.mjs 9.99 USD      # override amount + currency
 *
 * Amount is given in MAJOR units (e.g. dollars) and defaults to 0.01. It is
 * converted to the minor units (cents) the open platform expects.
 *
 * Credentials are loaded from example/.env.local (git-ignored). Node 20.6+
 * (built-in fetch + process.loadEnvFile), zero external deps.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** server/ lives under js/example/. */
const EXAMPLE_ROOT = join(__dirname, '..');

// Load sandbox credentials from example/.env.local (git-ignored). A missing
// file is tolerated here; createSession() will throw a clear error if the
// required credentials turn out to be absent.
try {
    process.loadEnvFile(join(EXAMPLE_ROOT, '.env.local'));
} catch {
    // No .env.local: createSession() will report missing credentials.
}

/** Default order amount in MAJOR units (e.g. dollars). */
export const DEFAULT_AMOUNT = 0.01;

export const CONFIG = {
    openApiUrl: process.env.OPEN_API_URL ?? 'https://open.sunbay-dev.com',
    apiKey: process.env.API_KEY,
    appId: process.env.APP_ID,
    merchantId: process.env.MERCHANT_ID,
    currency: process.env.CURRENCY ?? 'USD',
};

/** True when all required sandbox credentials are present. */
export const HAS_CREDENTIALS = Boolean(CONFIG.apiKey && CONFIG.appId && CONFIG.merchantId);

/** Convert a MAJOR-unit amount (e.g. 0.01) to minor units (cents): 0.01 -> 1. */
function toMinorUnits(major) {
    return Math.round(Number(major) * 100);
}

/**
 * Create a checkout session via the open platform, using the sandbox merchant
 * key held on the server.
 *
 * @param {{ amount?: number, items?: {name:string,amount:number,num:number}[],
 *           description?: string, returnUrl?: string, currency?: string,
 *           collectBillingAddress?: boolean, collectShippingAddress?: boolean }} [input]
 *   `amount` is in MAJOR units and defaults to 0.01. If `items` is supplied it
 *   takes precedence over `amount`.
 * @returns {Promise<object>} open-platform response data (includes sessionId)
 */
export async function createSession(input = {}) {
    if (!HAS_CREDENTIALS) {
        throw new Error(
            'Sandbox merchant credentials missing. Copy example/.env.example to ' +
                'example/.env.local and fill in API_KEY / APP_ID / MERCHANT_ID.'
        );
    }

    const currency = input.currency ?? CONFIG.currency;

    // Default to a single item priced at the given amount (default 0.01 major
    // units). An explicit `items` array wins over `amount` when provided.
    const items =
        Array.isArray(input.items) && input.items.length > 0
            ? input.items
            : [
                  {
                      name: 'SDK Example Item',
                      amount: toMinorUnits(input.amount ?? DEFAULT_AMOUNT),
                      num: 1,
                  },
              ];

    const orderAmount = items.reduce((sum, i) => sum + Number(i.amount) * Number(i.num), 0);
    const taxAmount = Math.round(orderAmount * 0.08);
    const now = Date.now();
    const requestId = `EX${now}`;
    const orderId = `EX${now}`;

    const payload = {
        appId: CONFIG.appId,
        transactionRequestId: requestId,
        referenceOrderId: orderId,
        merchantId: CONFIG.merchantId,
        amount: {
            orderAmount,
            taxAmount,
            priceCurrency: currency,
        },
        description: input.description ?? 'SDK example order',
        productList: items,
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

/**
 * Convenience wrapper: create a session and return only the token (sessionId).
 *
 * @param {Parameters<typeof createSession>[0]} [input]
 * @returns {Promise<string>} the session token (sessionId)
 */
export async function getToken(input = {}) {
    const data = await createSession(input);
    return data.sessionId;
}

// When run directly: print a token. Optional CLI args: <amount> [currency].
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [amountArg, currencyArg] = process.argv.slice(2);
    const input = {};
    if (amountArg !== undefined) {
        input.amount = Number(amountArg);
    }
    if (currencyArg !== undefined) {
        input.currency = currencyArg;
    }

    getToken(input)
        .then((token) => {
            // eslint-disable-next-line no-console
            console.log(token);
        })
        .catch((err) => {
            // eslint-disable-next-line no-console
            console.error(`create-session failed: ${err.message}`);
            if (err.detail) {
                // eslint-disable-next-line no-console
                console.error(JSON.stringify(err.detail, null, 2));
            }
            process.exit(1);
        });
}
