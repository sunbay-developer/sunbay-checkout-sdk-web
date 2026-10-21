# Sunbay Checkout Web SDK

Browser SDK for embedding Sunbay Checkout into merchant web pages. It renders
payment UI (card fields, Apple Pay / Google Pay express buttons) inside secure,
Sunbay-hosted iframes, so **card data never touches the merchant page**.

This repository is a pnpm workspace with three packages:

| Package | Name | Description |
| --- | --- | --- |
| `protocol/` | `@sunbay/checkout-sdk-protocol` | Shared SDK ↔ hosted-runtime protocol contract (single source of truth). |
| `js/` | `@sunbay/checkout-sdk-js` | Browser JS SDK — the `createCheckout` entry point merchants use. |
| `react/` | `@sunbay/checkout-sdk-react` | React bindings (planned, placeholder). |

## Install

```bash
npm install @sunbay/checkout-sdk-js
```

Or load the IIFE build via a `<script>` tag, which exposes `window.SunbayCheckout`.

## Quick start

A checkout session is created **server-side** by your backend (it holds the
merchant API key). The browser only receives a `sessionId`.

```ts
import { createCheckout } from '@sunbay/checkout-sdk-js';

// 1. Create the checkout instance from a server-created session.
const checkout = await createCheckout({
    sessionId, // from your backend
    env: 'prod',
});

// 2. Mount Elements into your DOM.
await checkout.create('cardNumber').mount('#card-number');
await checkout.create('cardExpiry').mount('#card-expiry');
await checkout.create('cardCvc').mount('#card-cvc');

// Express wallets (Apple Pay / Google Pay) render their own buttons.
const express = checkout.create('expressCheckout');
express.on('expressAvailabilityChange', (evt) => {
    console.log('available wallets:', evt.availableWallets);
});
await express.mount('#express');

// 3. Confirm a card payment; the result arrives as a PaymentOutcome.
checkout.on('paymentResult', (evt) => console.log(evt));
const outcome = await checkout.confirm();
```

## Real-device testing

A real-device (Playwright) end-to-end test suite lives in
[`test-e2e/`](./test-e2e/README.md). It drives the published SDK build inside a
standalone merchant-page harness against the hosted runtime, covering embedding
modes, element combinations, theming/element customization, the payment flow,
and the PCI card-isolation invariant. See
[`test-e2e/RUNNING.md`](./test-e2e/RUNNING.md) for how to run it.

## Documentation

Full API reference and integration guides will be published on a dedicated
documentation site. A link will be added here once available.

## Development

```bash
pnpm install
pnpm --filter @sunbay/checkout-sdk-protocol run build
pnpm --filter @sunbay/checkout-sdk-js run type-check
pnpm --filter @sunbay/checkout-sdk-js run test
```

The protocol package is the single source of truth for the SDK ↔ hosted-runtime
contract. Compatibility is enforced at runtime by the protocol major version,
not by the npm version.
