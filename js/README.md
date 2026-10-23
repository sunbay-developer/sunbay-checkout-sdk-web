# @sunbay/checkout-sdk-js

Browser JS SDK for embedding **Sunbay Checkout** into merchant web pages. It
renders payment UI — card fields and Apple Pay / Google Pay express buttons —
inside secure, Sunbay-hosted iframes, so **card data never touches the merchant
page**.

`createCheckout` is the single entry point: you create a checkout session
server-side, hand the resulting `sessionId` to the browser, mount Elements into
your DOM, and confirm the payment.

## Install

```bash
npm install @sunbay/checkout-sdk-js
```

The protocol contract ([`@sunbay/checkout-sdk-protocol`](https://www.npmjs.com/package/@sunbay/checkout-sdk-protocol))
comes in transitively — you do not need to install it separately.

## Quick start

A checkout session is created **server-side** by your backend (it holds the
merchant API key). The browser only ever receives a `sessionId`.

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

## Public API

| Export | Description |
| --- | --- |
| `createCheckout(options)` | Creates a `CheckoutInstance` from a server-created session. Options include `sessionId` and `env` (`'test' \| 'prod'`). |
| `CheckoutInstance` | The checkout handle: `create(elementType)`, `confirm()`, `on(event, handler)`, `update(...)`, `destroy()`. |
| `CheckoutElement` | A mounted UI element handle: `mount(selector)`, `update(...)`, `on(...)`, `destroy()`. |
| `version` | The SDK version string. |
| Protocol types | Public TS types re-exported from `@sunbay/checkout-sdk-protocol` (`PaymentOutcome`, `PublicSessionView`, `Appearance`, `ElementType`, `ElementOptions`, `CheckoutError`, …). |

## Security model

Card data is entered only inside Sunbay-hosted iframes and is encrypted and sent
directly to Sunbay — it is never exposed to the merchant page or passed across
the SDK boundary. This keeps the merchant integration out of PCI card-data
scope.

## Versioning

The JS SDK and the protocol contract are released **in lockstep** and always
share the same version number.
