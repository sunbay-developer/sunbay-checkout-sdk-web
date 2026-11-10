# Sunbay Checkout JS SDK — API Reference

Complete reference for `@sunbay/checkout-sdk-js`. For a narrative walkthrough and
examples, see [`guide.md`](./guide.md).

All types prefixed with the protocol contract are re-exported from
`@sunbay/checkout-sdk-js` for TypeScript consumers, so you can import them
directly from the SDK package.

---

## Table of contents

- [Package exports](#package-exports)
- [`createCheckout`](#createcheckout)
- [`CheckoutInstance`](#checkoutinstance)
- [`CheckoutElement`](#checkoutelement)
- [Element types & options](#element-types--options)
- [Appearance types](#appearance-types)
- [Session & payment types](#session--payment-types)
- [Payment outcomes](#payment-outcomes)
- [Events](#events)
- [Error codes](#error-codes)
- [Environments & timeouts](#environments--timeouts)

---

## Package exports

```ts
import {
    createCheckout,
    CheckoutInstance,
    CheckoutElement,
    ErrorCode,
    version,
} from '@sunbay/checkout-sdk-js';

import type {
    CreateCheckoutOptions,
    CheckoutInstanceOptions,
    ConfirmOptions,
    CheckoutElementOptions,
    Env,
    // protocol types (re-exported)
    ErrorCodeValue,
    CheckoutError,
    CheckoutErrorCategory,
    PaymentOutcome,
    PublicSessionView,
    PublicPaymentMethod,
    PublicProductLine,
    PaymentMethod,
    PaymentMethodFilter,
    Appearance,
    AddressInfo,
    TxnStatus,
    ElementType,
    ElementOptions,
    ElementStatus,
    CardElementOptions,
    CardFieldElementOptions,
    AddressElementOptions,
    ExpressCheckoutElementOptions,
} from '@sunbay/checkout-sdk-js';
```

| Export            | Kind    | Description                                                   |
| ----------------- | ------- | ------------------------------------------------------------- |
| `createCheckout`  | function | The single async entry point. Returns a `CheckoutInstance`.  |
| `CheckoutInstance` | class   | The checkout instance handle.                                |
| `CheckoutElement` | class   | The Element handle.                                          |
| `ErrorCode`       | const   | Object map of error code string constants.                   |
| `version`         | string  | The SDK package version (injected at build time).            |

In the IIFE build, `window.SunbayCheckout = { createCheckout }`.

---

## `createCheckout`

```ts
function createCheckout(opts: CreateCheckoutOptions): Promise<CheckoutInstance>;
```

Creates a checkout instance. Internally it: generates a `checkoutId`, resolves
the hosted origin, loads a hidden main iframe, awaits the runtime handshake
(`RuntimeHello`, 15s timeout), negotiates a common protocol major version, sends
`initialize`, and resolves a ready `CheckoutInstance`.

The returned Promise **rejects** when:

- the handshake times out → `RUNTIME_LOAD_FAILED`;
- there is no common protocol major version → `PROTOCOL_UNSUPPORTED`;
- `initialize` fails (e.g. session load error) → the corresponding
  `CheckoutError`.

### `CreateCheckoutOptions`

```ts
interface CreateCheckoutOptions {
    sessionId: string; // required — server-created session id
    env?: Env; // 'dev' | 'test' | 'prod', default 'prod'
    hostOrigin?: string; // override the hosted origin (takes precedence over env)
    locale?: string; // e.g. 'en', 'zh'
    appearance?: Appearance; // initial theming (see Appearance types)
    paymentMethods?: PaymentMethodFilter; // hide/reorder the session's methods (not the Express wallet toggles)
    billingAddress?: AddressInfo; // host-collected billing address (see "Host-provided addresses")
    shippingAddress?: AddressInfo; // host-collected shipping address
}
```

| Field            | Type                 | Required | Notes                                                                 |
| ---------------- | -------------------- | -------- | --------------------------------------------------------------------- |
| `sessionId`      | `string`             | yes      | Created by your backend; cannot be replaced for the instance's life.  |
| `env`            | `Env`                | no       | Selects a built-in hosted origin. Defaults to `'prod'`.               |
| `hostOrigin`     | `string`             | no       | Explicit origin (no trailing slash); overrides `env`. For local dev/tests. |
| `locale`         | `string`             | no       | Falls back to the session's language, then `en`.                      |
| `appearance`     | `Appearance`         | no       | Serialized into each Element iframe `src` for a flash-free first frame. |
| `paymentMethods` | `PaymentMethodFilter` | no      | Hide and/or reorder methods using backend identifiers (see [`PaymentMethodFilter`](#paymentmethod--paymentmethodfilter)). Cannot enable methods the session disallowed. Unknown identifiers are ignored with a `warning` event. |

> There is also an internal `__transportFactory` injection point used by tests.
> It is **not** part of the public API contract and must not be relied upon.

### Example

```ts
const checkout = await createCheckout({
    sessionId: 'sess_x',
    env: 'prod',
    locale: 'en',
    appearance: { colorScheme: 'light', variables: { colorPrimary: '#2266ee' } },
    paymentMethods: { hide: ['APPLE_PAY'], order: ['CARD', 'GOOGLE_PAY'] },
});
```

---

## `CheckoutInstance`

Constructed by `createCheckout`. Do not instantiate directly.

### Read-only properties

| Property       | Type                  | Description                                |
| -------------- | --------------------- | ------------------------------------------ |
| `checkoutId`   | `string`              | Unique client-side instance id.            |
| `runtimeId`    | `string`              | Negotiated runtime id from the handshake.  |
| `capabilities` | `readonly string[]`   | Capability set advertised by the runtime.  |

### `create(type, options?)`

```ts
create(type: ElementType, options?: ElementOptions): CheckoutElement;
```

Synchronously creates an Element handle (not yet mounted) and registers it in the
instance's mutual-exclusion registry. Rendering happens on `mount()`.

- **Throws** `INSTANCE_DESTROYED` if the instance is destroyed.
- **Throws** `ELEMENT_CONFLICT` on a mutual-exclusion conflict (see
  [Mutual-exclusion rules](./guide.md#mutual-exclusion-rules)).

### `confirm(opts?)`

```ts
confirm(opts?: ConfirmOptions): Promise<PaymentOutcome>;
```

Initiates a **card** payment confirmation. The SDK generates an `operationId`,
sends the `confirm` command to obtain an "accepted" acknowledgement, and the
returned Promise is fulfilled by a later `paymentResult` event carrying the same
`operationId`.

- Only one confirmation may be in progress at a time. Calling again while in
  progress **rejects** `CHECKOUT_BUSY`.
- **Rejects** `INSTANCE_DESTROYED` if the instance is destroyed.
- If the `confirm` command itself fails, the Promise rejects with that error and
  no `paymentResult` will arrive.
- Express wallet payments are **not** started via `confirm()` — they are driven
  by the wallet button's own click path.

```ts
type ConfirmOptions = {
    billingAddress?: AddressInfo;
    shippingAddress?: AddressInfo;
    customerName?: string;
    email?: string;
    returnUrl?: string;
};
```

(`ConfirmOptions` is `ConfirmReq` without the instance-generated `operationId`.)

> `returnUrl` is the authentication-return target, not a success page. A full-page
> redirect destroys the JS context; the original `confirm()` Promise is not
> guaranteed to survive navigation. On return, re-initialize and query the server
> status.

### `getSession()`

```ts
getSession(): Promise<PublicSessionView>;
```

Fetches the latest session view and updates the local snapshot. **Rejects**
`INSTANCE_DESTROYED` if destroyed.

### `refresh()`

```ts
refresh(): Promise<PublicSessionView>;
```

Reloads the server session (e.g. after your backend updates the order) and
updates the local snapshot. Does not auto-retry payment. **Rejects**
`INSTANCE_DESTROYED` if destroyed.

### `getPaymentStatus()`

```ts
getPaymentStatus(): Promise<GetPaymentStatusResp>;
// GetPaymentStatusResp = { txnStatus: TxnStatus; txnId?: string }
```

Returns a server payment-status snapshot verbatim (no transformation).
**Rejects** `INSTANCE_DESTROYED` if destroyed. See [`TxnStatus`](#txnstatus).

### `updateCheckout(patch)`

```ts
updateCheckout(patch: {
    locale?: string;
    appearance?: Appearance;
    billingAddress?: AddressInfo;
    shippingAddress?: AddressInfo;
}): Promise<void>;
```

Updates presentation (locale / appearance) and the host-provided addresses at runtime. Does **not**
change the session or the amount. Passing an address replaces the previous one (pass `{}` to clear it).
**Rejects** `INSTANCE_DESTROYED` if destroyed, and `CHECKOUT_BUSY` if an address is passed while a
payment is in progress.

#### Host-provided addresses

If your page already collected the billing and/or shipping address, pass it to `createCheckout` /
`updateCheckout` so Apple Pay and Google Pay do **not** ask the user again.

- **Complete** means: billing = `country`, `city`, `line1`, `postalCode`; shipping = those four plus a
  name (`firstName` + `lastName`, or `recipientName`) and `phone`. An incomplete address is treated as
  not provided (the wallet still asks) and a `warning` (`ADDRESS_INCOMPLETE`) is emitted.
- A complete address makes the wallet skip asking for that address and submits yours instead. It can
  only **reduce** what is asked: if the session does not require the address, yours is not submitted
  (wallet or card). If the wallet itself returns an address, the wallet's wins. When the wallet did not
  return a name, the shipping `recipientName` (or `firstName lastName`) is used.
- For card payments it is the default for `confirm()` (also only when the session requires that
  address). Priority per address:
  `confirm({ billingAddress | shippingAddress })` > the mounted Address Element's draft > the address
  passed here.
- **Address Element:** it is optional (use it only if you do not build your own address form). If an
  Address Element of that mode (billing / shipping) is mounted and has collected an address, the
  address passed here is **ignored** and a `warning` (`ADDRESS_ENTRY_IGNORED`) is emitted. For wallets,
  which must decide synchronously, the address passed here is ignored whenever an Address Element of
  that mode exists.
- Only the documented `AddressInfo` fields are accepted (strings only); anything else is dropped.

### `on(event, handler)` / `off(event, handler)`

```ts
on(event: EventName, handler: (payload: unknown) => void): void;
off(event: EventName, handler: (payload: unknown) => void): void;
```

Register / unregister a checkout-level event handler.

- `on()` returns `void` — it does **not** return an unsubscribe function. Keep a
  reference to the handler to pass to `off()`.
- `on()` throws `INSTANCE_DESTROYED` if the instance is destroyed; `off()` is
  always safe to call (even after destruction).
- Historical events are not replayed; subscribe before `confirm()`.

See [Events](#events) for payloads.

### `destroy()`

```ts
destroy(): void;
```

Idempotent. Releases all Elements, unbinds the internal `paymentResult` listener,
rejects any pending `confirm()` with `INSTANCE_DESTROYED`, sends the `destroy`
command, and destroys the transport. Any late `paymentResult` afterwards is
ignored. **Does not** cancel a backend order.

---

## `CheckoutElement`

Returned by `CheckoutInstance.create(...)`. Do not instantiate directly.

### Read-only properties

| Property    | Type                  | Description                                                     |
| ----------- | --------------------- | --------------------------------------------------------------- |
| `elementId` | `string`              | Unique Element id (used to pair commands/events).               |
| `type`      | `ElementType`         | The Element type.                                               |
| `mode`      | `string \| undefined` | For `address` Elements: `'billing'` / `'shipping'`.             |

### `mount(selectorOrEl)`

```ts
mount(selectorOrEl: string | HTMLElement): Promise<void>;
```

Inserts a visible iframe into the target container, sends `createElement`, and
resolves on the `elementReady` event.

- The target must resolve to **exactly one** element and must be **empty**;
  otherwise rejects `INVALID_OPTIONS`.
- Calling `mount()` on an already-mounted Element (`loading` / `ready`) rejects
  `ELEMENT_CONFLICT`.
- On load failure the node is removed and the Promise rejects (`loadError`
  payload error, or `INVALID_OPTIONS` / `RUNTIME_LOAD_FAILED`).
- **Throws** `INSTANCE_DESTROYED` synchronously if the Element is destroyed.

The outer iframe's height tracks the content automatically; width stays `100%`.

### `unmount()`

```ts
unmount(): Promise<void>;
```

Sends `destroyElement` and removes the iframe, but **keeps the handle and its
configuration** so it can be remounted. Idempotent (a no-op if not mounted).
**Throws** `INSTANCE_DESTROYED` if destroyed.

### `destroy()`

```ts
destroy(): void;
```

Idempotent. Removes the iframe, unbinds listeners, sets status to `destroyed`,
and frees its mutual-exclusion slot in the instance. Afterwards, any call other
than `destroy()` / `off()` throws `INSTANCE_DESTROYED`.

### `update(patch)`

```ts
update(patch: Partial<ElementOptions>): Promise<void>;
```

Sends `updateElement`. The hosted side rejects illegal fields wholesale (no
partial application); on success the local options are written back. **Throws**
`INSTANCE_DESTROYED` if destroyed.

### `getStatus()`

```ts
getStatus(): ElementStatus; // 'created' | 'loading' | 'ready' | 'destroyed' | 'loadError'
```

Returns a read-only status snapshot.

### `getAvailableWallets()`

```ts
getAvailableWallets(): AvailableWallets | undefined;
// AvailableWallets = { applePay: boolean; googlePay: boolean }
```

**`expressCheckout` only.** Returns the current wallet-availability snapshot
(initially from `elementReady`, then updated by `expressAvailabilityChange`).
Returns `undefined` for other types or before ready.

### `on(event, handler)` / `off(event, handler)`

Same semantics as the instance methods. `on()` throws `INSTANCE_DESTROYED` if
destroyed; `off()` is always safe. See [Events](#events).

### `focus()` / `blur()` / `clear()`

```ts
focus?(): Promise<void>;
blur?(): Promise<void>;
clear?(): Promise<void>;
```

**Input-type Elements only** (`card`, `cardNumber`, `cardExpiry`, `cardCvc`,
`address`). These methods are **absent** (`undefined`) on `expressCheckout`
Elements. Each throws `INSTANCE_DESTROYED` if the Element is destroyed.

---

## Element types & options

```ts
type ElementType =
    | 'card'
    | 'cardNumber'
    | 'cardExpiry'
    | 'cardCvc'
    | 'address'
    | 'expressCheckout';
```

```ts
type ElementOptions =
    | CardElementOptions
    | CardFieldElementOptions
    | AddressElementOptions
    | ExpressCheckoutElementOptions;
```

### `CardElementOptions` (`card`)

```ts
interface CardElementOptions {
    showBillingAddress?: boolean;
    showShippingAddress?: boolean;
    showPostalCode?: boolean;
    appearance?: Appearance;
}
```

`show*` flags default to following the session's `collect*` flags; an explicit
`false` only hides the UI and does not relax the backend requirement.

### `CardFieldElementOptions` (`cardNumber` / `cardExpiry` / `cardCvc`)

```ts
interface CardFieldElementOptions {
    appearance?: Appearance;
}
```

### `AddressElementOptions` (`address`)

```ts
interface AddressElementOptions {
    mode: 'billing' | 'shipping'; // required; immutable after creation
    appearance?: Appearance;
}
```

### `ExpressCheckoutElementOptions` (`expressCheckout`)

```ts
interface ExpressCheckoutElementOptions {
    paymentMethods?: {
        applePay?: boolean | ApplePayOptions;
        googlePay?: boolean | GooglePayOptions;
    };
    layout?: { maxColumns?: number };
    buttonHeight?: number; // px; hosted side clamps to [30, 64]; default 40
}

interface ApplePayOptions {
    buttonTheme?: 'black' | 'white' | 'white-outline';
    buttonType?:
        | 'plain' | 'buy' | 'donate' | 'check-out' | 'book' | 'subscribe'
        | 'reload' | 'add-money' | 'top-up' | 'order' | 'rent' | 'support'
        | 'contribute' | 'tip';
}

interface GooglePayOptions {
    buttonTheme?: 'black' | 'white' | 'default';
    buttonType?:
        | 'buy' | 'plain' | 'checkout' | 'pay' | 'donate' | 'book'
        | 'order' | 'subscribe';
}
```

Per-wallet toggle semantics:

- `false` → force-hide that wallet.
- `true` or omitted → auto-show (session allows ∩ environment available); theme
  follows the current color scheme.
- object form → auto-show and apply the fine-grained options.

Only the display options documented here are accepted (`paymentMethods.applePay|googlePay`,
`layout.maxColumns`, `buttonHeight`). Any other key, or a `buttonTheme` / `buttonType` outside the
official values, is ignored and reported via a `warning` event (`code: 'EXPRESS_OPTION_IGNORED'`).
Wallet payment parameters (merchant id, networks, gateway, …) come only from the backend session
and cannot be overridden from the SDK.

---

## Appearance types

```ts
interface Appearance {
    variables?: AppearanceVariables;
    rules?: Partial<Record<AppearanceRuleTarget, AppearanceRuleStyle>>;
    colorScheme?: 'light' | 'dark' | 'auto';
}
```

The SDK defaults `colorScheme` to `'light'` when omitted; `'auto'` follows the
host/system preference.

### `AppearanceVariables`

| Variable          | Maps to                      | Value         |
| ----------------- | ---------------------------- | ------------- |
| `colorPrimary`    | primary (also drives ring)   | color string  |
| `colorBackground` | background / card / popover  | color string  |
| `colorText`       | foreground                   | color string  |
| `colorBorder`     | border / input               | color string  |
| `colorDanger`     | destructive                  | color string  |
| `borderRadius`    | radius                       | length string |
| `fontFamily`      | `:root` font-family          | string        |

All optional. Values enter `<style>` only after hosted-side whitelist
validation. Property names are camelCase; the hosted side converts to kebab-case.

### `AppearanceRuleTarget`

```ts
type AppearanceRuleTarget =
    | 'input'
    | 'input:focus'
    | 'input:invalid'
    | 'label'
    | 'error'
    | 'cardBrand'
    | 'cvvIcon';

type AppearanceRuleStyle = Record<string, string>; // CSS property → value
```

You supply **semantic keys** (not raw selectors). Both property names and values
are whitelist-validated by the hosted side; non-whitelisted entries are
discarded. Arbitrary CSS/HTML is not allowed.

---

## Session & payment types

### `PublicSessionView`

```ts
interface PublicSessionView {
    sessionId: string;
    sessionType: string;
    currency: string;
    totalAmount: number;
    productList: PublicProductLine[];
    taxAmount: number;
    productAmount: number;
    description: string;
    expiresAt: string;
    collectBillingAddress: boolean;
    collectShippingAddress: boolean;
    paymentMethods: PublicPaymentMethod[];
    merchantName: string;
    merchantLogoUrl: string;
    merchantReturnUrl?: string;
}

interface PublicProductLine {
    amount: number;
    name: string;
    num: string;
}

interface PublicPaymentMethod {
    method: string;
    type: string;
    name: string;
    logoUrl: string;
}
```

The public view intentionally excludes sensitive/internal fields (such as
`rsaPublicKey`).

### `PaymentMethod` & `PaymentMethodFilter`

```ts
// Backend uppercase enum (open union): 'CARD' | 'GOOGLE_PAY' | 'APPLE_PAY' | (string & {})
type PaymentMethod = string;

interface PaymentMethodFilter {
    hide?: string[]; // identifiers to hide
    order?: string[]; // display order (identifiers)
}
```

**Identifiers** use the backend values, matched **case-sensitively** — first against the
logical key, then against the raw method:

| Identifier                 | Matches                                                      |
| -------------------------- | ------------------------------------------------------------ |
| `CARD`                     | **All** card brands (VISA, MASTERCARD, AMEX, …)              |
| `APPLE_PAY`, `GOOGLE_PAY`  | That wallet                                                  |
| A raw method, e.g. `AMEX`  | Only that card brand (hide / order a single brand)           |
| Other backend methods      | Same rule: use the backend `method` value                    |

`order` lists the identifiers that come first; unlisted methods keep their original order after
them. **Where `order` is visible:** the page layout is yours, so `order` only changes (1) the order
of `session.paymentMethods` returned to you and (2) the order of the card brand icons inside the
card Element. It does **not** reorder the Express wallet buttons — Apple Pay is always rendered
before Google Pay. Legacy lower-case names (`card`, `applePay`, `googlePay`) are **not** recognized.

The filter is subtractive/reordering only — it cannot enable methods the session did not allow.
It is applied everywhere the methods are used: the `session.paymentMethods` returned by
`createCheckout` / `getSession()` / `refresh()`, the Express wallet buttons, and the card brand icons.

An identifier that matches nothing (unknown, or not offered to this user/merchant) is **ignored** —
it never makes `createCheckout` / `getSession()` / `refresh()` fail. A `warning` event
(`code: 'PAYMENT_METHOD_FILTER_IGNORED'`) is emitted once per identifier and a `console.warn` is logged.
Warnings raised while `createCheckout` itself runs (before you have an instance) are delivered to the
**first** `checkout.on('warning', …)` listener you register, asynchronously, exactly once.

> **Not the same as the Express option.** `createCheckout({ paymentMethods })` filters the
> session's methods. `expressCheckout`'s `paymentMethods: { applePay, googlePay }` toggles/styles
> the wallet buttons of that Element. They are independent.
>
> The filter is set once at `createCheckout` and cannot be updated afterwards.

### `WarningEvent` & warning codes

```ts
interface WarningEvent {
    code: WarningCode; // one of WARNING_CODES
    ignored: string[]; // ignored identifiers / option paths
    reason: string;
}
```

**Warning code registry (cross-platform).** The codes live in one place — `WARNING_CODES` in
`@sunbay/checkout-sdk-protocol` — and are shared by the Web, iOS and Android SDKs. A platform that
needs a new code adds it to `WARNING_CODES` and to this table; do not invent platform-local codes.

| Code                             | Meaning                                                                        | `ignored` contains        |
| -------------------------------- | ------------------------------------------------------------------------------ | ------------------------- |
| `PAYMENT_METHOD_FILTER_IGNORED`  | A `paymentMethods` filter identifier matched nothing (or `hide`/`order` was not an array). | The identifiers (`hide` / `order` for a bad container) |
| `EXPRESS_OPTION_IGNORED`         | An `expressCheckout` option was not whitelisted or had an invalid value.        | Option paths, e.g. `paymentMethods.applePay.buttonType` |
| `ADDRESS_INCOMPLETE`             | A host-provided `billingAddress` / `shippingAddress` was incomplete, so it was treated as not provided. | `billingAddress` / `shippingAddress` |
| `ADDRESS_ENTRY_IGNORED`          | A host-provided address was ignored because our Address Element owns that mode. | `billingAddress` / `shippingAddress` |

Warnings are non-fatal, de-duplicated per `code + identifier`, and never change a payment outcome.

### `AddressInfo`

```ts
interface AddressInfo {
    country: string;
    state?: string;
    city: string;
    line1: string;
    line2?: string;
    postalCode: string;
    district?: string;
    firstName?: string;
    lastName?: string;
    recipientName?: string;
    phone?: string;
}
```

### `TxnStatus`

```ts
type TxnStatus = 'I' | 'S' | 'F' | 'R';
```

| Value | Meaning                               | Terminal? |
| ----- | ------------------------------------- | --------- |
| `I`   | unpaid / created                      | no        |
| `S`   | succeeded                             | yes       |
| `F`   | failed                                | yes       |
| `R`   | requires redirect / processing        | no        |

---

## Payment outcomes

```ts
type PaymentOutcome =
    | { status: 'succeeded'; operationId: string; txnId: string }
    | { status: 'failed'; operationId: string; txnId?: string; error: CheckoutError }
    | { status: 'canceled'; operationId: string }
    | { status: 'pending'; operationId: string; txnId?: string };
```

| Status      | Terminal? | Meaning                                                                 |
| ----------- | --------- | ----------------------------------------------------------------------- |
| `succeeded` | yes       | Payment succeeded; `txnId` is the transaction id.                       |
| `failed`    | yes       | Explicit failure / decline; see `error`.                                |
| `canceled`  | yes       | The user canceled the current interaction — **not** an order cancel.    |
| `pending`   | **no**    | Result not yet known. Do not re-charge; poll `getPaymentStatus()` / await a later `paymentResult`. |

`operationId` identifies one client interaction and is distinct from the server
`txnId`. Consumers must **not** accept only the first result for an operation —
`pending` is not terminal.

---

## Events

Register with `on(event, handler)` / remove with `off(event, handler)`.
Historical events are not replayed. `on()` returns `void`.

```ts
type EventName =
    | 'ready'
    | 'change'
    | 'focus'
    | 'blur'
    | 'loadError'
    | 'elementReady'
    | 'expressAvailabilityChange'
    | 'paymentStateChange'
    | 'paymentResult'
    | 'error'
    | 'warning';
```

### Element-level events

| Event          | Payload                                                             | Notes                                                    |
| -------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| `ready`        | `{ elementId }`                                                     | Fired once per successful mount.                         |
| `elementReady` | `{ elementId; availableWallets? }`                                  | `availableWallets` only for `expressCheckout`.           |
| `change`       | `{ elementId; empty; complete; error?; brand? }`                    | `brand` only on the card-number field. Never a card value. |
| `focus`        | `{ elementId }`                                                     | No input value.                                          |
| `blur`         | `{ elementId }`                                                     | No input value.                                          |
| `loadError`    | `{ elementId; error: CheckoutError }`                              | Same error id as the corresponding `mount()` rejection.  |

### Express event

| Event                       | Payload                        | Notes                                |
| --------------------------- | ------------------------------ | ------------------------------------ |
| `expressAvailabilityChange` | `{ availableWallets }`         | `expressCheckout` only. No elementId. |

```ts
interface AvailableWallets {
    applePay: boolean;
    googlePay: boolean;
}
```

### Checkout-level events

| Event                | Payload                                              | Notes                                                        |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| `paymentStateChange` | `{ operationId; method; state; action? }`            | Intermediate/process info only.                              |
| `paymentResult`      | `{ operationId; method; outcome: PaymentOutcome }`   | Covers card and express. Fulfills the matching `confirm()`.  |
| `error`              | `{ operationId?; error: CheckoutError }`             | Async proactive-flow error (e.g. a wallet failure).          |
| `warning`            | `{ code; ignored: string[]; reason: string }`        | Non-fatal: merchant input was ignored (see `WarningEvent`).  |

```ts
interface PaymentAction {
    type: 'qrCode' | 'redirect' | 'showContent';
    redirectUrl?: string;
    qrData?: string;
    content?: string;
}
```

---

## Error codes

All errors are `CheckoutError` objects:

```ts
interface CheckoutError {
    code: string;
    message: string;
    category: 'configuration' | 'validation' | 'network' | 'runtime' | 'payment';
    errorId: string;
    elementId?: string;
    field?: string;
    traceId?: string;
}
```

The `ErrorCode` constant provides the string codes:

```ts
import { ErrorCode } from '@sunbay/checkout-sdk-js';
ErrorCode.VALIDATION_ERROR; // 'VALIDATION_ERROR'
```

| Code                     | Raised when                                                                       | Thrown / Rejected |
| ------------------------ | --------------------------------------------------------------------------------- | ----------------- |
| `INVALID_OPTIONS`        | `mount()` target not found/unique or not empty; invalid options.                  | reject            |
| `ELEMENT_CONFLICT`       | Mutual-exclusion conflict on `create()`, or `mount()` called twice.               | throw / reject    |
| `INSTANCE_DESTROYED`     | Using an instance/Element after `destroy()`, or a pending `confirm()` on destroy. | throw / reject    |
| `CHECKOUT_BUSY`          | `confirm()` called while a confirmation is already in progress.                   | reject            |
| `VALIDATION_ERROR`       | Card validation failed during `confirm()`.                                        | reject            |
| `SESSION_LOAD_FAILED`    | The session could not be loaded during `initialize`.                              | reject            |
| `RUNTIME_LOAD_FAILED`    | Handshake timed out, or the main iframe / element failed to load.                 | reject            |
| `PROTOCOL_UNSUPPORTED`   | No common protocol major version between SDK and runtime.                         | reject            |
| `REQUEST_TIMEOUT`        | A protocol command timed out.                                                     | reject            |
| `PAYMENT_FLOW_ERROR`     | An error in the payment flow (surfaced via a failed outcome or the `error` event). | — / event        |
| `UNSUPPORTED_CAPABILITY` | An explicitly requested capability is not supported by the runtime.               | reject            |

> There is intentionally no generic `retryable` boolean. Use the specific `code`
> to decide recovery, and never re-charge on a `pending` outcome. `message` is for
> display; `code` is for program logic.

`ErrorCodeValue` is the string-literal union of all `ErrorCode` values.

---

## Environments & timeouts

### `Env` and hosted origins

```ts
type Env = 'dev' | 'test' | 'prod';
```

| `env`   | Hosted origin                      |
| ------- | ---------------------------------- |
| `dev`   | `https://checkout.sunbay-dev.com`  |
| `test`  | `https://checkout.sunbay-uat.us`   |
| `prod` (default) | `https://checkout.sunbay.us`      |

Pass `hostOrigin` to override (e.g. `http://localhost:3000` for local
integration); it takes precedence over `env`.

### Timeouts

The transport uses these default timeouts (configurable internally, not part of
the public API):

| Phase                   | Default |
| ----------------------- | ------- |
| Regular command         | 10 s    |
| `initialize`            | 30 s    |
| Handshake (`hello`)     | 15 s    |

These are transport/runtime policies, **not** payment deadlines. A payment that
is still waiting resolves to `pending` and should be reconciled via
`getPaymentStatus()`; a command timeout must never trigger an automatic
re-`confirm()`.
