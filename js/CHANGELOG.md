# Changelog

All notable changes to `@sunbay/checkout-sdk-js` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The SDK and
`@sunbay/checkout-sdk-protocol` share the same version number.

## [0.0.6] - Unreleased

### Changed

- `confirm()` now resolves only on a terminal outcome (`succeeded` | `failed` | `canceled`).
  A `pending` outcome keeps the Promise waiting. After the watchdog (default 120000 ms,
  `resultTimeoutMs`) it resolves `{ status: 'pending', operationId }`, which is not a failure:
  reconcile with `getPaymentStatus()` and do not retry.
- The confirm slot stays held (`CHECKOUT_BUSY`) until a terminal result, or `destroy()` and a
  new `createCheckout`. A `confirm` command timeout rejects with `paymentStateKnown: false`.
- The hosted runtime is loaded from `/embed/sdk/*`. Deploy the runtime before upgrading the SDK.
- `on()` / `off()` on instances and elements are typed by event name; `element.on` is scoped to
  the element's `elementId`.
- Exceptions thrown by event listeners are rethrown asynchronously (reaching `window.onerror`)
  instead of being swallowed, and no longer break other listeners.
- The handshake only accepts messages from the SDK's own runtime iframe and ignores malformed hellos.

### Added

- `confirm({ onOperation, resultTimeoutMs })` options.
- `element.mount(target, { timeoutMs })` (default 30000 ms, rejects `RUNTIME_LOAD_FAILED` and
  removes the iframe). `unmount()` / `destroy()` during loading reject the in-flight `mount()`.
- `error` events carry `method`, `stage` (`WalletErrorStage`), `backendCode`, `traceId`,
  `providerCode` and `paymentStateKnown`; wallet failures also emit a `paymentResult`
  sharing the `operationId`.
- Documented `env: 'dev'`, `hostOrigin`, `updateCheckout` and merchant-side handling of
  redirect / 3DS actions (the SDK only emits `paymentStateChange`).

### Fixed

- `destroy()` releases the hosted element; late `elementReady` after cancellation is ignored.
