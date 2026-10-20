# AGENTS.md — js (@sunbay/checkout-sdk-js)

Merchant-facing browser JS SDK. Read the repo-root `checkout-sdk-web/AGENTS.md`
before starting.

---

## 1. Responsibilities and entry point

- The single async entry point `createCheckout(options)` → returns a
  `CheckoutInstance`.
- Public exports (`src/index.ts`): `createCheckout`, `CheckoutInstance`,
  `CheckoutElement` and their option types, `version`, and **re-exported**
  public protocol types (`ErrorCode`, `CheckoutError`, `PublicSessionView`,
  each Element's options, etc.) for TS consumers.
- The IIFE build mounts `window.SunbayCheckout = { createCheckout }` in the
  browser.

### Source layout (`src/`)
- `createCheckout.ts` — entry orchestration: generate `checkoutId` → resolve
  host origin → create transport + hidden main iframe → await `RuntimeHello`
  (15s timeout) → pick common `PROTOCOL_MAJOR` (no intersection →
  `PROTOCOL_UNSUPPORTED`) → send `initialize` → construct `CheckoutInstance`.
- `CheckoutInstance.ts` — instance handle: createElement/confirm/getSession/
  getPaymentStatus/destroy, etc.
- `Element.ts` — the `CheckoutElement` handle (card / cardField / address /
  expressCheckout, etc.).
- `transport/MainFrameTransport.ts` — transport layer: creates the hidden,
  zero-size main iframe (`${hostOrigin}/sdk/main?checkoutId=...`), pairs
  request/response by `requestId`, dispatches event envelopes; **security
  filter** accepts only messages where `event.origin === hostOrigin` and the
  `checkoutId` matches.
- `config/env.ts` — `Env` and host-origin resolution.

---

## 2. Protocol dependency (workspace)

- `dependencies: { "@sunbay/checkout-sdk-protocol": "workspace:*" }` — points to
  the local `../protocol` via the pnpm workspace.
- Import all protocol types/constants from the package name
  `@sunbay/checkout-sdk-protocol`; **do not** use relative paths into the
  protocol source, and do not keep a local copy.
- After changing the protocol, `build protocol` first; js picks it up
  immediately (workspace symlink). On publish, pnpm replaces `workspace:*` with
  the real version number.

---

## 3. Security constraint (PCI)

- The transport envelope and every SDK layer **never carry card data**
  (plaintext or ciphertext). createCheckout / Instance / Element / transport
  only perform the handshake, orchestration, and protocol-envelope relay.
- Card data is encrypted locally with RSA inside the hosted-runtime page and
  sent directly to the backend; it never passes through this SDK or the iframe
  message channel.

---

## 4. Build and test

```bash
pnpm --filter @sunbay/checkout-sdk-js run type-check   # tsc --noEmit
pnpm --filter @sunbay/checkout-sdk-js run test         # vitest run (jsdom)
pnpm --filter @sunbay/checkout-sdk-js run build        # tsup: esm+cjs+iife+dts
```

- `tsup.config.ts`: entry `src/index.ts`, formats `['esm','cjs','iife']`,
  `globalName: 'SunbayCheckout'`, `dts: true`, `sourcemap: true`, `clean: true`.
- Artifacts in `dist/`: `index.mjs` (esm) / `index.cjs` (cjs) /
  `index.global.js` (iife) / `index.d.ts` (+`.d.cts`). `files` publishes only
  `dist`.
- Tests: Vitest + jsdom, under `test/`, `*.test.ts`. Service/transport tests
  drive hello/events via mocks.
- type-check/build depends on protocol's built `dist` (available immediately
  within the workspace).

---

## 5. Notes

- When adding a public API, remember to export it in `src/index.ts`, and
  re-export protocol types where needed.
- Changing handshake / transport / protocol logic is sensitive: state clearly
  what was verified and what was not; breaking protocol changes must bump major
  per `protocol/AGENTS.md`.
