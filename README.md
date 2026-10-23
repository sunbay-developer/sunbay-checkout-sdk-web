# Sunbay Checkout Web SDK

The Sunbay Checkout Web SDK lets merchants embed Sunbay's payment experience
directly into their own web pages. Payment UI — card fields and Apple Pay /
Google Pay express buttons — is rendered inside secure, **Sunbay-hosted
iframes**, so sensitive card data is entered, encrypted, and transmitted within
Sunbay's domain and **never touches the merchant page**. This keeps the merchant
integration out of PCI card-data scope while still letting merchants control
layout, theming, and the checkout flow.

This repository is a **pnpm workspace** (the workspace root is the repository
root) containing the browser-facing packages of the SDK.

## Packages

| Package | Name | Role |
| --- | --- | --- |
| [`protocol/`](./protocol) | [`@sunbay/checkout-sdk-protocol`](https://www.npmjs.com/package/@sunbay/checkout-sdk-protocol) | The shared SDK ↔ hosted-runtime protocol contract — the single source of truth. Types and constants only. |
| [`js/`](./js) | [`@sunbay/checkout-sdk-js`](https://www.npmjs.com/package/@sunbay/checkout-sdk-js) | The browser JS SDK. `createCheckout` is the entry point merchants integrate against. |
| `react/` | `@sunbay/checkout-sdk-react` | React bindings. Planned — placeholder, not yet published. |

Native SDKs (React Native / iOS / Android) are planned and live in their own
separate repositories.

## How it fits together

```
Merchant page
  └── @sunbay/checkout-sdk-js        ← merchants integrate here
        │  speaks the protocol
        ▼
  @sunbay/checkout-sdk-protocol      ← shared contract (single source of truth)
        ▲
        │  the hosted runtime implements the same contract
  Sunbay-hosted iframe runtime       ← renders card fields / wallet buttons
```

- The **protocol** package defines the message envelope, commands, events, error
  codes, and public data shapes. Both the SDK and the Sunbay-hosted runtime
  depend on it; it depends on nothing (one-way dependency, zero reverse deps).
- The **js** package wraps that contract in an ergonomic, merchant-facing API
  (`createCheckout`, Elements, events, `confirm()`).
- Compatibility between the SDK and the hosted runtime is enforced at runtime by
  the **protocol major version**, independent of the npm package version.

## Getting started

Merchant integration lives in the JS SDK — see
**[`js/README.md`](./js/README.md)** for installation and a full quick start.

```bash
npm install @sunbay/checkout-sdk-js
```

## Versioning

The `protocol` and `js` packages are published **in lockstep**: they always
share the same version number, so a given `@sunbay/checkout-sdk-js` always pairs
with the matching `@sunbay/checkout-sdk-protocol`. Releases are cut with
[`scripts/release.sh`](./scripts/release.sh).

## Development

```bash
pnpm install
pnpm --filter @sunbay/checkout-sdk-protocol run build
pnpm --filter @sunbay/checkout-sdk-js run type-check
pnpm --filter @sunbay/checkout-sdk-js run test
```

## Real-device testing

A real-device (Playwright) end-to-end suite lives in
[`test-e2e/`](./test-e2e/README.md). It drives the published SDK build inside a
standalone merchant-page harness against the hosted runtime, covering embedding
modes, element combinations, theming/element customization, the payment flow,
and the PCI card-isolation invariant. See
[`test-e2e/RUNNING.md`](./test-e2e/RUNNING.md) for how to run it.
