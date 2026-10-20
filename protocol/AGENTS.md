# AGENTS.md — protocol (@sunbay/checkout-sdk-protocol)

The **single source of truth** for the SDK ↔ hosted-runtime protocol contract.
Read the repo-root `checkout-sdk-web/AGENTS.md` before starting.

---

## 1. Responsibilities and boundaries

- Defines the envelope, commands, events, error codes, and public types between
  the SDK (`js`) and the hosted runtime (`checkout/src/sdk-runtime`).
- **Zero reverse dependencies**: protocol must not depend on `js` or the
  runtime. The dependency direction is one-way.
- Source of truth is `src/`; the two consumer kinds consume it via the workspace
  (js) and the published npm package (checkout). **No source copies exist.**

---

## 2. Export entry (`src/index.ts`)

The single entry aggregates the modules below; consumers import only from the
package root `@sunbay/checkout-sdk-protocol`:

- `envelope.ts` — `PROTOCOL_NAME` (`'sunbay-checkout'`), `PROTOCOL_MAJOR`
  (currently `1`), `encodeEnvelope` / `decodeEnvelope`, `EnvelopeDecodeError`,
  `Envelope`, `RuntimeHello`.
- `errors.ts` — `ErrorCode` and `ErrorCodeValue`.
- `commands.ts` — `COMMAND_NAMES` / `isCommandName` and each command's Req/Resp
  types (initialize, createElement, updateElement, destroyElement,
  elementAction, updateCheckout, getSession, getPaymentStatus, confirm,
  destroy).
- `events.ts` — `EVENT_NAMES` / `isEventName` and each event's payload type
  (ready, elementReady, change, focus, blur, loadError,
  expressAvailabilityChange, paymentStateChange, paymentResult, error).
- `types.ts` — public domain types (TxnStatus, AddressInfo, PaymentMethod,
  PublicSessionView, PaymentOutcome, CheckoutError, Appearance, each Element's
  options, etc.).

> The protocol name `sunbay-checkout` and `major=1` are a **different protocol**
> from the Native Bridge's `{v:1,...}`; the same number does not imply
> compatibility.

---

## 3. semver contract discipline

- **Breaking changes** (removing/renaming envelope fields, commands, events, or
  error codes, or changing their semantics/requiredness) → **bump npm major**
  and **bump `PROTOCOL_MAJOR` in sync**; the runtime handshake rejects
  incompatible peers.
- Backward-compatible additions (new command/event/optional field) → minor.
- Fixes/comments/build → patch.
- **Runtime compatibility is governed by the handshake `PROTOCOL_MAJOR`**; the
  npm version is for dependency management only.
- `decodeEnvelope` performs minimal runtime structural validation
  (protocol/major/kind/required fields); `RuntimeHello` (`kind:'hello'`) has no
  checkoutId yet during handshake and is recognized separately by the transport,
  not via `decodeEnvelope`.

---

## 4. Build (tsup)

```bash
pnpm --filter @sunbay/checkout-sdk-protocol run build        # tsup: esm(.mjs)+cjs(.cjs)+dts
pnpm --filter @sunbay/checkout-sdk-protocol run type-check   # tsc --noEmit
```

- `tsup.config.ts`: entry `src/index.ts`, formats `['esm','cjs']`, `dts: true`,
  `sourcemap: true`, `clean: true`.
- Artifacts in `dist/`: `index.mjs` / `index.cjs` / `index.d.ts` (+`.d.cts`).
  `package.json`'s `exports` / `main` / `module` / `types` point to them;
  `files` publishes only `dist`.
- `js` type-check/build depends on this package's `dist`, so **after changing
  the protocol you must build this package first** for js to pick up the latest
  types and artifacts (immediate within the workspace).

---

## 5. Notes

- When changing the protocol, if the `checkout` repo's hosted runtime has
  corresponding docs (e.g. bridge/payload specs), keep code and docs in sync.
- Do not reintroduce the deprecated `sync-protocol.mjs` source-copy mechanism.
