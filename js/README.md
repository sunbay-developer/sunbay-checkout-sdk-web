# @sunbay/checkout-sdk-js

Browser JS SDK for embedding **Sunbay Checkout** into merchant web pages. It
renders the payment UI inside secure, Sunbay-hosted iframes, so merchants can
accept a growing range of payment methods while sensitive payment details never
touch the merchant page. This keeps your integration PCI-compliant and your
customers' data protected out of the box.

`createCheckout` is the single entry point: you create a checkout session
server-side, hand the resulting `sessionId` to the browser, mount Elements into
your DOM, and confirm the payment.

> **Behavior changes in 0.0.6**
>
> - **`confirm()` now resolves only on a terminal outcome** (`succeeded` | `failed` | `canceled`).
>   Previously it resolved on the first `paymentResult`, including a non-final `pending` one.
>   A `pending` outcome keeps the Promise waiting. If no terminal outcome arrives within
>   `resultTimeoutMs` (default 120000ms) it resolves `{ status: 'pending', operationId }` - this is
>   not a failure; reconcile with `getPaymentStatus()` and never retry blindly. The confirm slot
>   stays occupied (`CHECKOUT_BUSY`) until a terminal outcome or `destroy()`. If the `confirm`
>   command itself times out, the Promise rejects with `paymentStateKnown: false` - reconcile, do
>   not retry. Use `confirm({ onOperation })` to capture the `operationId` early.
> - **`element.mount(target, { timeoutMs })`** now times out (default 30000ms, `RUNTIME_LOAD_FAILED`)
>   and removes the iframe. `unmount()` / `destroy()` while loading reject the in-flight mount
>   (`RUNTIME_LOAD_FAILED` / `INSTANCE_DESTROYED`), and `destroy()` releases the hosted element.
> - **Listeners (0.0.6, typed events):** `element.on()` handlers are scoped to that element and
>   handler errors are isolated; see the API notes for details.
> - The handshake now only accepts messages from the SDK's own runtime iframe and ignores malformed
>   hellos.

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
