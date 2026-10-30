# Changelog

All notable changes to `@sunbay/checkout-sdk-js` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The SDK and
`@sunbay/checkout-sdk-protocol` share the same version number.

## [0.0.6] - Unreleased

### Changed

- **Breaking:** `createCheckout()` now requires `checkoutClientSecret` (returned by the backend's
  `create-session` when `sessionType` is `embedded`). A missing, blank or non-string value rejects
  with `INVALID_OPTIONS` before any iframe is created. Existing sessions must be re-created with
  `sessionType: embedded`. The protocol field `InitializeReq.checkoutClientSecret` is optional.
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
  instead of being swallowed, and no longer break other listeners. This may trigger merchant
  error monitoring.
- TypeScript: the typed `on()` / `off()` generics may turn handler annotations that do not match
  the event payload into compile errors. The `FocusEvent` / `BlurEvent` type re-exports shadow the
  DOM globals unless aliased on import.
- Merchants or WAF / CSP rules that allowlist hosted paths rather than the origin must allow
  `/embed/sdk/*` (a block shows up as a 15 s `RUNTIME_LOAD_FAILED`). Legacy `/sdk/*` remains
  served for SDK <= 0.0.5.
- The handshake only accepts messages from the SDK's own runtime iframe and ignores malformed hellos.

### Runtime behavior changes (apply to all SDK versions once the hosted runtime is deployed)

- The submit lock stays held after an unknown payment state (5xx / network) until a terminal
  result, so a retry gets `CHECKOUT_BUSY`: reconcile with `getPaymentStatus()` and wait.
- Pre-submit wallet failures now emit **both** `error` and a failed `paymentResult` with the same
  `operationId` / `errorId`: de-duplicate by `operationId`.
- The Apple Pay sheet closes as completed when the final state is unknown (the SDK reports
  `pending`): show a "processing, do not pay again" UI.
- Polling continues past the 120 s diagnostic deadline.

### Added

- `confirm({ onOperation, resultTimeoutMs })` options.
- `element.mount(target, { timeoutMs })` (default 30000 ms, rejects `RUNTIME_LOAD_FAILED` and
  removes the iframe). `unmount()` / `destroy()` during loading reject the in-flight `mount()`.
- `error` events carry `method`, `stage` (`WalletErrorStage`), `backendCode`, `traceId`,
  `providerCode` and `paymentStateKnown`; pre-submit wallet failures also emit a failed
  `paymentResult` sharing the `operationId`. `WalletErrorStage` `availability` is reserved and
  not emitted yet.
- Documented `env: 'dev'`, `hostOrigin`, `updateCheckout` and merchant-side handling of
  redirect / 3DS actions (the SDK only emits `paymentStateChange`).

### Fixed

- `destroy()` releases the hosted element; late `elementReady` after cancellation is ignored.
- A `mount()` timeout releases the hosted element, so a retry `mount()` does not hit `ELEMENT_CONFLICT`.
