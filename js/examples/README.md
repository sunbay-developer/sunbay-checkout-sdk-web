# Checkout SDK — End-to-end merchant integration demo

This directory is a **complete merchant integration sample** showing how a real
merchant embeds payments with the Checkout JS SDK on **their own site**
(a standalone origin):

- `server.mjs` — simulates the merchant backend (Node 18+, zero dependencies):
  serves the frontend page and exposes `POST /api/create-session`, which — using
  the **merchant API key on the server** — places an order against the Sunbay
  open platform and returns a `sessionId` (the key is never sent to the browser,
  which also avoids the browser's CORS limits when calling the open platform
  directly).
- `merchant-demo.html` — simulates the merchant frontend: a `<script>` loads the
  SDK build, calls `createCheckout`, mounts the **split card fields**
  (cardNumber / cardExpiry / cardCvc) and **expressCheckout** (Apple / Google
  Pay), and triggers `confirm`.

> Why not validate this inside the checkout project: the checkout hosted page
> and a real merchant page are **not same-origin**. Only a standalone-origin
> sample (this demo server defaults to `:8080`, checkout to `:3000`) truly
> covers the SDK's cross-origin postMessage / origin checks / cross-iframe
> channels.

## Architecture (three roles, three origins)

```
Merchant frontend (merchant-demo.html)   Merchant backend (server.mjs)   Sunbay platform
  http://localhost:8080                     http://localhost:8080          open.sunbay-dev.com
        │                                          │                             │
        │  ① POST /api/create-session              │                             │
        │─────────────────────────────────────────▶│                             │
        │                                          │  ② create-session w/ key    │
        │                                          │────────────────────────────▶│
        │  ③ { sessionId }                          │◀────── { sessionId } ───────│
        │◀─────────────────────────────────────────│                             │
        │
        │  ④ createCheckout({ sessionId, hostOrigin: http://localhost:3000 })
        │       ├── hidden main iframe + card-field / express iframes (all hosted on checkout :3000)
        │       └── confirm / wallet buttons → payment
        ▼
   checkout hosted runtime (http://localhost:3000)
```

## Prerequisites

- Node **18+** (`server.mjs` uses built-in `fetch`; `.env.local` auto-loading
  uses `process.loadEnvFile`, Node 20.6+).
- The checkout hosted page running locally (serves `/sdk/main`,
  `/sdk/field/<type>`, `/sdk/element/<type>`).
- The SDK IIFE build `../dist/index.global.js` is built.

## Run the demo (four steps)

### 1. Start the checkout hosted page (:3000)

```bash
cd /path/to/checkout
npm run dev            # http://localhost:3000
```

### 2. Build the SDK

```bash
cd /path/to/checkout-sdk-web/js
pnpm install
pnpm run build         # generates dist/index.global.js
```

### 3. Configure demo credentials

Merchant credentials are read from `.env.local` (git-ignored). Copy the template
and fill in your own values:

```bash
cp .env.example .env.local
# edit .env.local: API_KEY, APP_ID, MERCHANT_ID
```

`server.mjs` auto-loads `.env.local` on startup. If required credentials are
missing, it prints the missing variable names and exits.

### 4. Start the demo server and open the page (:8080)

```bash
cd /path/to/checkout-sdk-web/js/examples
node server.mjs        # http://localhost:8080
```

Open **http://localhost:8080/examples/merchant-demo.html**.

> The demo server port and platform parameters can also be overridden via env:
> `PORT`, `OPEN_API_URL`, `CURRENCY` (these have safe defaults; the merchant
> credentials `API_KEY` / `APP_ID` / `MERCHANT_ID` are required).

## Steps in the UI

1. Click "① Create order and initialize":
   - the frontend calls the merchant backend `/api/create-session` → the server
     places the order → returns a `sessionId`;
   - `sessionId` is used to call `createCheckout` (`hostOrigin` pointing at
     checkout `:3000`);
   - mounts expressCheckout and the three split card fields.
2. Card payment: enter card number / expiry / CVC in the fields → click
   "② Pay (confirm)".
3. Express payment: click the Apple / Google Pay button directly (see "Real
   device requirements" below).
4. The result area shows the `paymentResult` event and the `PaymentOutcome`
   returned by `confirm`.

## Acceptance points

- **Full integration loop**: create order → initialize → mount (card fields +
  express) → pay → receive result.
- **Card data isolation**: card data exists only inside the checkout hosted
  iframe; the events the parent window (this page) observes never contain any
  card value (plaintext or ciphertext). Verify with DevTools on the parent
  window's postMessages.
- **Key never leaves the server**: the merchant API key is used only in
  `server.mjs`; the browser never receives it.

## Real device requirements (Apple / Google Pay)

expressCheckout button availability follows "subtract-only": wallets allowed by
the session ∩ available in the browser environment − merchant `never`. Actually
invoking a wallet sheet requires:

- **Google Pay**: an HTTPS test domain + Google test merchant configuration
  (delivered via the session `ewalletParam`).
- **Apple Pay**: Safari + an Apple device with a card + backend Apple
  capabilities (Merchant ID, Merchant Identity Certificate, domain verification
  file, merchant validation endpoint).

In an ordinary browser without the above, the available-wallet set may be empty
(buttons do not render) — this is expected; the card payment path is unaffected.
