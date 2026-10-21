# Sunbay Checkout JS SDK — Integration Guide

`@sunbay/checkout-sdk-js` is the browser JavaScript SDK for embedding Sunbay
Checkout into a merchant web page. It renders payment UI — split or combined
card fields, an address form, and Apple Pay / Google Pay express buttons —
inside **secure, Sunbay-hosted iframes**, so that **card data never touches the
merchant page**.

For the complete, type-by-type API reference see [`api.md`](./api.md).

---

## Table of contents

1. [Overview](#1-overview)
2. [Installation](#2-installation)
3. [Quick start](#3-quick-start)
4. [Core concepts](#4-core-concepts)
5. [Features](#5-features)
6. [Examples](#6-examples)
7. [Theming & appearance](#7-theming--appearance)
8. [Events](#8-events)
9. [Error handling](#9-error-handling)
10. [Security & PCI model](#10-security--pci-model)
11. [Real-device testing](#11-real-device-testing)

---

## 1. Overview

The SDK has a **single async entry point**, `createCheckout(options)`, which
resolves to a `CheckoutInstance`. From the instance you `create(...)` one or more
`CheckoutElement` handles, `mount(...)` them into your DOM, and finally
`confirm()` a card payment or let the express wallet buttons drive their own
payment.

```
createCheckout(options) ──▶ CheckoutInstance
                                 │
                                 ├─ create('cardNumber')  ──▶ CheckoutElement ──▶ mount('#card-number')
                                 ├─ create('cardExpiry')  ──▶ CheckoutElement ──▶ mount('#card-expiry')
                                 ├─ create('cardCvc')     ──▶ CheckoutElement ──▶ mount('#card-cvc')
                                 ├─ create('expressCheckout') ─▶ CheckoutElement ─▶ mount('#express')
                                 │
                                 └─ confirm() ──▶ PaymentOutcome
```

Architecturally the SDK orchestrates a handshake with the Sunbay-hosted runtime
loaded in a **hidden main iframe**, then mounts **visible child iframes** for
each Element. All card data lives exclusively inside those hosted iframes; the
SDK only relays protocol envelopes (never card values).

### What you need from your backend

A checkout session is created **server-side** by your backend (it holds the
merchant API key). The browser only ever receives a `sessionId`. Amount,
currency, product lines, and the merchant's address-collection requirements all
come from the session — the client cannot override them.

---

## 2. Installation

### npm / pnpm / yarn (ESM or CJS)

```bash
npm install @sunbay/checkout-sdk-js
```

```ts
import { createCheckout } from '@sunbay/checkout-sdk-js';
```

The package ships ESM (`import`), CommonJS (`require`), and TypeScript type
declarations. It has no runtime dependencies other than the shared protocol
contract package.

### Script tag (IIFE build)

Loading the IIFE build via a `<script>` tag exposes a `window.SunbayCheckout`
global:

```html
<script src="https://.../@sunbay/checkout-sdk-js/dist/index.global.js"></script>
<script>
  const { createCheckout } = window.SunbayCheckout;
</script>
```

### Requirements

- A modern browser with `postMessage`, `MessageChannel`, and `ResizeObserver`.
- A valid `sessionId` obtained from your server.
- Network access to the Sunbay-hosted checkout origin (configured via `env` or
  `hostOrigin`).

---

## 3. Quick start

```ts
import { createCheckout } from '@sunbay/checkout-sdk-js';

// 1. Create the checkout instance from a server-created session.
const checkout = await createCheckout({
    sessionId, // obtained from your backend
    env: 'prod',
});

// 2. Mount Elements into your DOM. (Split card fields shown here.)
await checkout.create('cardNumber').mount('#card-number');
await checkout.create('cardExpiry').mount('#card-expiry');
await checkout.create('cardCvc').mount('#card-cvc');

// 3. (Optional) Express wallets render their own buttons.
const express = checkout.create('expressCheckout');
express.on('expressAvailabilityChange', (evt) => {
    console.log('available wallets:', evt.availableWallets);
});
await express.mount('#express');

// 4. Confirm a card payment; the result arrives as a PaymentOutcome.
checkout.on('paymentResult', (evt) => console.log('result event:', evt));

try {
    const outcome = await checkout.confirm();
    if (outcome.status === 'succeeded') {
        // show success UI; outcome.txnId is the transaction id
    }
} catch (err) {
    // CheckoutError — e.g. VALIDATION_ERROR, CHECKOUT_BUSY
}
```

> The `confirm()` Promise resolves with the **terminal** `PaymentOutcome`. It
> may also resolve with `status: 'pending'`, which is **not** a terminal state —
> see [Payment outcomes](./api.md#payment-outcomes).

---

## 4. Core concepts

### CheckoutInstance

Represents one client-side payment context. A single instance can manage
multiple Elements and drives a single card `confirm()` at a time.

- `checkoutId` — a client-side instance id, distinct from the backend
  `sessionId`.
- `runtimeId` — negotiated with the hosted runtime during the handshake.
- `capabilities` — the capability set the hosted runtime advertised.

### CheckoutElement

A handle to one piece of payment UI rendered in its own iframe. Element types:

| Type              | Description                                        | Input actions (`focus`/`blur`/`clear`) |
| ----------------- | -------------------------------------------------- | --------------------------------------- |
| `card`            | Combined card input area (optionally with address) | yes                                     |
| `cardNumber`      | Standalone card-number field                       | yes                                     |
| `cardExpiry`      | Standalone expiry field                            | yes                                     |
| `cardCvc`         | Standalone CVC field                               | yes                                     |
| `address`         | Billing or shipping address form                   | yes                                     |
| `expressCheckout` | Apple Pay / Google Pay button cluster              | no                                      |

Element state machine: `created → loading → ready → destroyed`, with
`loadError` as a side branch if loading fails.

### Mutual-exclusion rules

Within one instance, `create(...)` enforces:

- The combined `card` Element and any split field (`cardNumber` / `cardExpiry` /
  `cardCvc`) are **mutually exclusive**.
- The same split card field type cannot be created twice.
- An `address` Element with the same `mode` (`billing` / `shipping`) cannot be
  duplicated.
- `expressCheckout` is a **singleton**.

Violations throw `ELEMENT_CONFLICT`. Destroying an Element frees its slot, so a
mutually-exclusive Element of the same kind can be recreated afterwards (useful,
for example, to switch express button options which require rebuilding the
iframe).

### Session is authoritative

`sessionId` cannot be replaced during the instance lifecycle; to switch sessions,
`destroy()` and create a new instance. Amount, currency, and the backend's
`collectBillingAddress` / `collectShippingAddress` requirements all come from the
session.

---

## 5. Features

- **Hosted, PCI-conscious card capture** — card data is entered and RSA-encrypted
  inside Sunbay-hosted iframes and sent directly to the backend; it never passes
  through the merchant page or the SDK message channel.
- **Split or combined card UI** — use the combined `card` Element or compose
  `cardNumber` / `cardExpiry` / `cardCvc` separately.
- **Address collection** — mount billing and/or shipping `address` Elements, or
  show address inside the combined `card` Element.
- **Express wallets** — a single `expressCheckout` Element renders Apple Pay and
  Google Pay buttons, with per-wallet theme/type and a global button height.
- **Appearance customization** — a whitelisted set of design variables and
  controlled semantic rules, plus a light/dark/auto color scheme. No arbitrary
  CSS (cross-origin + PCI).
- **Auto-sizing iframes** — Element iframes report their content height and the
  SDK resizes the outer iframe automatically (width stays 100%).
- **Payment method filtering** — subtract or reorder the session's methods on the
  client; you cannot enable methods the session did not allow.
- **Typed events** — subscribe to element and checkout-level events with typed
  payloads (re-exported for TypeScript consumers).

---

## 6. Examples

### 6.1 Combined card Element with billing address

```ts
const checkout = await createCheckout({ sessionId, env: 'prod' });

const card = checkout.create('card', {
    showBillingAddress: true,
    showPostalCode: true,
});
await card.mount('#card');

const outcome = await checkout.confirm({
    customerName: 'Jane Doe',
    email: 'jane@example.com',
});
```

### 6.2 Split card fields with a separate address Element

```ts
const checkout = await createCheckout({ sessionId, env: 'prod' });

await checkout.create('cardNumber').mount('#card-number');
await checkout.create('cardExpiry').mount('#card-expiry');
await checkout.create('cardCvc').mount('#card-cvc');

const billing = checkout.create('address', { mode: 'billing' });
await billing.mount('#billing');

const outcome = await checkout.confirm();
```

### 6.3 Express checkout (Apple Pay / Google Pay)

```ts
const checkout = await createCheckout({ sessionId, env: 'prod' });

const express = checkout.create('expressCheckout', {
    paymentMethods: {
        applePay: { buttonType: 'buy', buttonTheme: 'black' },
        googlePay: { buttonType: 'pay' },
    },
    buttonHeight: 48,
    layout: { maxColumns: 2 },
});

// React to wallet availability (buttons only render for available wallets).
express.on('expressAvailabilityChange', (evt) => {
    const { applePay, googlePay } = evt.availableWallets;
    toggleWalletSectionHeader(applePay || googlePay);
});

await express.mount('#express');

// Wallets drive their own confirmation; observe the result via events.
checkout.on('paymentResult', (evt) => {
    if (evt.outcome.status === 'succeeded') showSuccess(evt.outcome.txnId);
});
```

> `expressCheckout` buttons are **triggered by the user** (a real click/tap
> gesture is required to open the wallet sheet). The SDK completes the payment
> after the wallet confirmation — you do **not** call `confirm()` for wallet
> payments.

### 6.4 Field validation state

```ts
const number = checkout.create('cardNumber');
number.on('change', (evt) => {
    // evt: { elementId, empty, complete, error?, brand? }
    if (evt.error) showFieldError('#card-number', evt.error.message);
    if (evt.brand) showBrandIcon(evt.brand);
});
await number.mount('#card-number');
```

### 6.5 Cleaning up

```ts
// Keep the handle, release the remote element (can be remounted later):
await card.unmount();

// Permanently release a single Element:
card.destroy();

// Release the whole instance (elements, listeners, pending confirm, transport):
checkout.destroy();
```

`destroy()` does **not** cancel a backend order. After `destroy()`, any call
other than `destroy()` / `off()` throws `INSTANCE_DESTROYED`.

---

## 7. Theming & appearance

Appearance is passed at creation time via `createCheckout({ appearance })` and
can be changed at runtime via `checkout.updateCheckout({ appearance })`. The
initial appearance is serialized into each Element's iframe `src` so the first
frame renders correctly with no flash.

Appearance has three parts:

### 7.1 Color scheme

```ts
await createCheckout({
    sessionId,
    appearance: { colorScheme: 'dark' }, // 'light' | 'dark' | 'auto'
});
```

SDK iframes default to **light**. `'auto'` follows the host/system preference.
Switch at runtime:

```ts
await checkout.updateCheckout({ appearance: { colorScheme: 'dark' } });
```

### 7.2 Design variables (whitelisted)

```ts
await createCheckout({
    sessionId,
    appearance: {
        variables: {
            colorPrimary: '#2266ee',
            colorBackground: '#ffffff',
            colorText: '#111827',
            colorBorder: '#d1d5db',
            colorDanger: '#dc2626',
            borderRadius: '8px',
            fontFamily: 'Inter, system-ui, sans-serif',
        },
    },
});
```

Only the whitelisted keys above are honored; everything else is validated and
discarded by the hosted side.

### 7.3 Controlled semantic rules

Fine-tune specific anchors inside the iframe. You provide **semantic keys** (not
raw selectors); the hosted side generates the selectors and whitelist-validates
every property/value.

```ts
await createCheckout({
    sessionId,
    appearance: {
        rules: {
            input: { padding: '12px' },
            'input:focus': { 'box-shadow': '0 0 0 2px #2266ee' },
            'input:invalid': { color: '#dc2626' },
            label: { 'font-weight': '600' },
            error: { 'font-size': '12px' },
            cardBrand: { opacity: '0.9' },
            cvvIcon: { opacity: '0.7' },
        },
    },
});
```

> Because Elements render in cross-origin iframes and the product is PCI-scoped,
> **arbitrary CSS/HTML is not allowed**. Only the whitelisted variables and the
> controlled rule anchors above are supported.

See [`api.md` → Appearance types](./api.md#appearance-types) for the full list of
variables and rule targets.

---

## 8. Events

Register handlers with `on(event, handler)` and remove them with
`off(event, handler)`. Historical events are **not** replayed after you
subscribe, so bind listeners **before** `mount()` / `confirm()`.

> `on()` returns `void` (it does not return an unsubscribe function). Keep a
> reference to the handler and pass it to `off()` to unsubscribe.

Element-level events (`change`, `focus`, `blur`, `ready`, `elementReady`,
`loadError`) carry an `elementId`; filter by your Element's `elementId` if you
share handlers across Elements. Checkout-level events (`paymentResult`,
`paymentStateChange`, `error`) are registered on the instance.

See [Events in api.md](./api.md#events) for every event name and payload.

---

## 9. Error handling

All SDK errors are structured `CheckoutError` objects:

```ts
interface CheckoutError {
    code: string; // machine-readable, e.g. 'VALIDATION_ERROR'
    message: string; // display message
    category: 'configuration' | 'validation' | 'network' | 'runtime' | 'payment';
    errorId: string;
    elementId?: string;
    field?: string;
    traceId?: string;
}
```

- **Synchronous configuration/usage errors** are thrown (e.g. `create(...)` with
  a conflict throws `ELEMENT_CONFLICT`; using a destroyed instance throws
  `INSTANCE_DESTROYED`).
- **Async flow errors** reject the returned Promise (e.g. `confirm()` rejects
  `CHECKOUT_BUSY` when a confirmation is already in progress, or
  `VALIDATION_ERROR` when card validation fails).
- **A real payment decline is a `PaymentOutcome`** with `status: 'failed'`, not a
  thrown error.

Use `code` for program logic and `message` for display. There is intentionally
**no generic `retryable` flag** — decide retries from the specific code (see the
[error code table](./api.md#error-codes)) to avoid accidental double-charges.

```ts
try {
    const outcome = await checkout.confirm();
    switch (outcome.status) {
        case 'succeeded':
            /* terminal success */ break;
        case 'failed':
            showError(outcome.error.message); break;
        case 'canceled':
            /* user canceled the current interaction, not the order */ break;
        case 'pending':
            // NOT terminal — poll getPaymentStatus() or wait for a later
            // paymentResult event; never re-charge based on pending.
            break;
    }
} catch (err) {
    const e = err as CheckoutError;
    if (e.code === 'CHECKOUT_BUSY') {
        /* a confirm is already running */
    }
}
```

---

## 10. Security & PCI model

- **Card data never touches the merchant page.** It is entered inside
  Sunbay-hosted iframes, RSA-encrypted there, and sent directly to the backend.
  The SDK, its transport envelopes, and the iframe message channel never carry
  card values (plaintext or ciphertext).
- **Origin-pinned messaging.** The transport only accepts `postMessage` events
  whose `origin` equals the hosted origin and whose envelope `checkoutId`
  matches the instance. Iframe auto-height messages are additionally verified by
  `event.source === iframe.contentWindow`.
- **No card data in appearance or events.** Appearance only carries display
  configuration; public events only expose allowed states such as `empty`,
  `complete`, `brand`, and `error` — never a card value. There is no
  `getValue()` for card data.
- **Keep your API key server-side.** Sessions are created by your backend; the
  browser only receives a `sessionId`.

---

## 11. Real-device testing

A real-device (Playwright) end-to-end test suite lives in
[`test-e2e/`](../../../test-e2e/README.md). It drives the published SDK build
inside a standalone merchant-page harness against the hosted runtime, covering:

- Handshake / initialization and the `window.SunbayCheckout` global.
- Embedding modes (combined card, split fields, address, express) and element
  combinations / mutual exclusion.
- Theming (`colorScheme`, `appearance.variables`, `appearance.rules`) both at
  init (no-flash via iframe src) and at runtime (`updateCheckout`).
- Express wallet button options and availability.
- The card payment flow (confirm → `paymentResult`) with sandbox test cards.
- The PCI invariant: card values never cross the SDK / parent window / postMessage.

See [`test-e2e/RUNNING.md`](../../../test-e2e/RUNNING.md) for how to start the
test backend + hosted runtime and run the suite (full, by priority, or a single
case).

> Express wallet buttons require real-device prerequisites (HTTPS + Google test
> merchant config for Google Pay; Safari + an Apple device with a card + backend
> Apple capabilities for Apple Pay). In an ordinary browser the available-wallet
> set may be empty and the buttons do not render — this is expected and does not
> affect the card payment path.
