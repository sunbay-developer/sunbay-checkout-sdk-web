# @sunbay/checkout-sdk-js

Browser JS SDK for embedding **Sunbay Checkout** into merchant web pages. Payment UI
renders inside Sunbay-hosted iframes, so card data never touches your page (PCI scope
stays out of your integration).

## Install

```bash
npm install @sunbay/checkout-sdk-js
```

The protocol types (`@sunbay/checkout-sdk-protocol`) come in transitively.

## Quick start

Create the checkout session **server-side** (your backend holds the API key) and pass
only the `sessionId` to the browser.

```ts
import { createCheckout } from '@sunbay/checkout-sdk-js';

const checkout = await createCheckout({ sessionId, env: 'test' });

await checkout.create('cardNumber').mount('#card-number');
await checkout.create('cardExpiry').mount('#card-expiry');
await checkout.create('cardCvc').mount('#card-cvc');

checkout.on('paymentResult', (evt) => console.log(evt.outcome));
const outcome = await checkout.confirm();
```

### `createCheckout` options

| Option | Description |
| --- | --- |
| `sessionId` | Required. Server-created session id. |
| `env` | `'dev' \| 'test' \| 'prod'` (default `'prod'`). Selects the hosted origin. |
| `hostOrigin` | Overrides the hosted origin (takes precedence over `env`), e.g. `http://localhost:3000`. |
| `locale` | UI locale, e.g. `'en-US'`, `'zh-CN'`. |
| `appearance` | `{ variables, rules, colorScheme }` (whitelisted design variables, no arbitrary CSS). |
| `paymentMethods` | `{ hide?: string[]; order?: string[] }` - subtract/sort only. |

The hosted runtime must serve `/embed/sdk/*` (SDK >= 0.0.6). Deploy the runtime before upgrading the SDK.

## Elements

`checkout.create(type, options?)` returns a handle; call `mount(target, { timeoutMs? })`
with a CSS selector or an empty `HTMLElement`.

| Type | Options | Notes |
| --- | --- | --- |
| `card` | `showBillingAddress`, `showShippingAddress`, `showPostalCode`, `appearance` | Combined card form. Exclusive with split fields. |
| `cardNumber` / `cardExpiry` / `cardCvc` | `appearance` | Split fields. Exclusive with `card`. |
| `address` | `mode: 'billing' \| 'shipping'` (required), `appearance` | One per mode. |
| `expressCheckout` | `paymentMethods.applePay` / `googlePay` (`false` hides; or `{ buttonTheme, buttonType }`), `layout.maxColumns`, `buttonHeight` (30-64, default 40) | Singleton. Wallet buttons. |

Handle methods: `mount`, `unmount`, `update(patch)`, `destroy`, `getStatus`,
`getAvailableWallets` (express), `on`, `off`. A conflicting `create` throws `ELEMENT_CONFLICT`.

## Events

`checkout.on(name, handler)` and `element.on(name, handler)` are typed by event name
(`EventPayloadMap`). `element.on` only receives events whose `elementId` is that
element's; payloads without an `elementId` pass through. Events are not replayed after
registration. Handler exceptions are isolated and rethrown asynchronously (they reach
`window.onerror` and never break other listeners).

| Event | Payload | Fired when |
| --- | --- | --- |
| `elementReady` | `{ elementId, availableWallets? }` | Element finished loading. |
| `ready` | `{ elementId }` | Input field is ready for input. |
| `change` | `{ elementId, empty, complete, error?, brand? }` | Field state changes (never the value). |
| `focus` / `blur` | `{ elementId }` | Field focus changes. |
| `loadError` | `{ elementId, error }` | Element failed to load. |
| `expressAvailabilityChange` | `{ availableWallets }` | Wallet availability changes. |
| `paymentStateChange` | `{ operationId, method, state, action? }` | Intermediate state, e.g. requires action. |
| `paymentResult` | `{ operationId, method, outcome }` | A payment outcome was produced. |
| `error` | `{ operationId?, method?, stage?, error }` | Asynchronous error (wallet flows etc.). |

## Payment result semantics

`await checkout.confirm(opts?)` resolves **only** on a terminal outcome:
`succeeded`, `failed` or `canceled`. If none arrives within the watchdog (default
120 s; per call `resultTimeoutMs`) it resolves `{ status: 'pending', operationId }`.

- `pending` or any unknown state is **not a failure**. Do **not** retry or let the user
  pay again. Reconcile with `getPaymentStatus()` (`txnStatus`: `I|S|F|R`) and wait for the
  terminal `paymentResult` event.
- The confirm slot stays held (`CHECKOUT_BUSY`) until a terminal result arrives, or you
  call `destroy()` and create a new instance with `createCheckout`. This also applies
  after the watchdog resolved `pending`.
- If the `confirm` command itself times out, the Promise rejects with
  `paymentStateKnown: false`: reconcile, do not retry. Use `confirm({ onOperation })` to
  capture the `operationId` early.

### Express wallets

A wallet button click has no Promise. Listen for **both** `paymentResult` and `error`
on the instance. Wallet failures emit both, sharing `operationId` and `error.errorId`;
de-duplicate by `operationId`.

```ts
const seen = new Set<string>();
checkout.on('paymentResult', (e) => {
    if (seen.has(e.operationId)) return;
    seen.add(e.operationId);
    showOutcome(e.outcome);
});
checkout.on('error', (e) => {
    if (e.operationId && seen.has(e.operationId)) return; // already handled
    reportError(e.error, e.method, e.stage);
});
```

Cancel (`outcome.status === 'canceled'`) emits only `paymentResult`, no `error`.

**Apple Pay:** when the final state is unknown the Apple Pay sheet closes as completed
while the SDK reports `pending`. Show your own "processing, do not pay again" UI.

### Errors (`CheckoutError`)

| Field | Meaning |
| --- | --- |
| `code`, `message` | Stable SDK code and display message. |
| `category` | `configuration \| validation \| network \| runtime \| payment`. |
| `errorId` | Unique id; shared by the `error` event and failed `paymentResult`. |
| `traceId` | Backend trace id, when available (quote it to support). |
| `backendCode` | Backend business code passthrough. |
| `providerCode` | Sanitized wallet provider error name. |
| `paymentStateKnown` | `false`: outcome unknown, reconcile before any retry. |

The `error` event also carries `method` (`'card' \| 'applePay' \| 'googlePay'`) and
`stage` (`WalletErrorStage`): `availability`, `merchantValidation`, `authorization`,
`submit`, `poll`, `runtime`.

### Redirect / 3DS

`paymentStateChange` may carry an `action`. The SDK **does not** perform redirects or
challenges: it only emits the event. Your page must handle the action.

## Lifecycle

- `mount(target, { timeoutMs })` times out after 30 s by default: the iframe is removed
  and it rejects `RUNTIME_LOAD_FAILED`.
- `unmount()` / `destroy()` while an element is loading rejects the in-flight `mount()`
  (`RUNTIME_LOAD_FAILED` / `INSTANCE_DESTROYED`). If you call `mount()` without
  `catch`/`await`, that surfaces as an **unhandled rejection**; always handle it.
- `checkout.updateCheckout({ locale?, appearance? })` hot-switches locale/appearance.
- `getSession()`, `refresh()`, `getPaymentStatus()` read session/payment state.
- `checkout.destroy()` is idempotent, removes all iframes, and later calls reject/throw
  `INSTANCE_DESTROYED`. Calling `destroy()` while a `confirm()` is pending rejects that
  `confirm()` with `INSTANCE_DESTROYED`.

## Behavior changes in 0.0.6

- `confirm()` resolves only terminal outcomes or the watchdog `pending` (see above); the
  slot is held until terminal or `destroy()`.
- `mount()` has a timeout (`timeoutMs`, default 30 s) and cancellation semantics.
- `on()` is typed per event name; `element.on` is scoped to its `elementId`.
- Hosted pages are loaded from `/embed/sdk/*`; deploy the runtime first.
- Listener errors are rethrown asynchronously instead of being swallowed.
- Handshake only accepts messages from the SDK's own runtime iframe.

## Security model

Card data is entered only in Sunbay-hosted iframes, encrypted and sent straight to
Sunbay. It never crosses the SDK boundary or reaches your page.

## Versioning

The JS SDK and the protocol contract are released in lockstep with the same version.
