# Checkout Web SDK — Examples

Runnable, framework-free browser examples for the public Web SDK
(`@sunbay/checkout-sdk-js`). Each page drives the **real published SDK**
(`window.SunbayCheckout`, loaded from the IIFE build) against the hosted runtime,
fronted by a tiny dependency-free Node backend that creates checkout sessions
with a sandbox merchant key.

This directory is for **learning and manual exploration**. It is not published
and is not the automated test suite — for the real-device Playwright suite see
[`../../test-e2e`](../../test-e2e). It deliberately reuses the same
session-mock backend shape (`POST /api/create-session`) so the two stay familiar.

---

## What's inside

| Page | File | Demonstrates |
|---|---|---|
| **Full card Element** | `public/full-element.html` | The minimal flow: session → `createCheckout` → `create('card')` → `mount` → `confirm`. |
| **Split fields + address** | `public/split-fields.html` | `cardNumber` / `cardExpiry` / `cardCvc` in separate slots + `billing` and `shipping` address Elements (needs `collectShippingAddress`). |
| **Theming & customization** | `public/theming.html` | (A) global theme via `appearance.variables` + `colorScheme` at init; (B) element-level `appearance.rules` + per-element isolation; (C) runtime hot-reload via `updateCheckout()`. |

```
example/
├── server/
│   └── server.mjs        # session-mock backend: /api/create-session, /healthz, static hosting
├── public/
│   ├── index.html        # landing page (links to the three examples)
│   ├── app.js            # shared helpers (health, session, SDK access, logging)
│   ├── styles.css        # demo chrome styles (the SDK iframes carry their own theme)
│   ├── full-element.html / full-element.js
│   ├── split-fields.html / split-fields.js
│   └── theming.html / theming.js
├── .env.example          # credential template → copy to .env.local
├── .gitignore
├── package.json
└── README.md
```

---

## Prerequisites

1. **Build the SDK IIFE artifact** the pages load (`js/dist/index.global.js`):

   ```bash
   # from the repo root
   pnpm --filter @sunbay/checkout-sdk-js run build
   ```

2. **Run the hosted runtime** the SDK talks to (serves `/embed/sdk/main`,
   `/embed/embed/sdk/field/*`, `/embed/embed/sdk/element/*`). Locally this is the `checkout` repo's dev
   server on `:3000`:

   ```bash
   # in the checkout repo, a separate terminal (start it yourself; the agent does not)
   npm run dev
   ```

   Point elsewhere by setting `HOSTED_ORIGIN` (see below).

3. **Provide sandbox credentials** so the backend can create sessions:

   ```bash
   cp example/.env.example example/.env.local
   # then fill in API_KEY / APP_ID / MERCHANT_ID
   ```

   Without credentials the server still serves the pages and `/healthz` (so you
   can inspect the UI), but `POST /api/create-session` returns 503 and the pages
   show a banner.

---

## Run

```bash
cd js/example
npm start            # node server/server.mjs  → http://localhost:8095
```

Then open <http://localhost:8095/> and pick an example.

The landing page and each example render a banner if a prerequisite is missing
(server down, SDK build absent, or credentials absent), with the exact fix.

---

## Environment variables

Read by `server/server.mjs` from `example/.env.local` (git-ignored).

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `API_KEY` | yes (for sessions) | — | Sandbox merchant key; stays server-side. |
| `APP_ID` | yes (for sessions) | — | Sandbox app id. |
| `MERCHANT_ID` | yes (for sessions) | — | Sandbox merchant id. |
| `PORT` | no | `8095` | Example server port. |
| `OPEN_API_URL` | no | `https://open.sunbay-dev.com` | Open-platform base for create-session. |
| `CURRENCY` | no | `USD` | Session currency. |
| `HOSTED_ORIGIN` | no | `http://localhost:3000` | Hosted runtime origin the SDK points at (exposed to the pages via `/healthz`). |

> `NEXT_PUBLIC_`-style exposure does not apply here; credentials never leave the
> server. The browser only learns `hostedOrigin` (non-sensitive) from `/healthz`.

---

## How a page uses the SDK (shape)

```js
import { getCreateCheckout, createSession } from '/app.js';

const sessionId = await createSession({ collectBillingAddress: true });
const createCheckout = getCreateCheckout();              // window.SunbayCheckout.createCheckout

const checkout = await createCheckout({
    sessionId,
    hostOrigin: 'http://localhost:3000',                 // from /healthz
    appearance: { colorScheme: 'light', variables: { colorPrimary: '#7c3aed' } },
});

const card = checkout.create('card', { showPostalCode: true });
await card.mount('#slot-card');

// Runtime theming hot-reload (no remount):
await checkout.updateCheckout({ appearance: { colorScheme: 'dark' } });

const outcome = await checkout.confirm();                // PaymentOutcome
```

### PCI note

Card data is entered **only inside the hosted iframes** the SDK renders; it is
RSA-encrypted locally in the hosted page and sent directly to the backend. The
example pages, `app.js`, and the session-mock backend never touch card values —
matching the SDK's security invariant.
