# Checkout Web SDK — Real-device test specification (test-e2e)

> This directory holds the **real-device test specification** for the public Web
> SDK (`@sunbay/checkout-sdk-js`). It describes how, in a real environment, to
> verify that the published SDK features all work, and it is the blueprint for a
> generated suite of **executable real-device tests** (one per case) that an AI
> can later run, read the results of, and act on.
>
> This is **not** unit testing. Unit/integration tests are already covered by
> `js/test/*` (Vitest + jsdom) and the `checkout` repo's `src/sdk-runtime/*`.
> Real-device tests run a **real browser + real cross-origin iframes + real
> session creation**, filling the gaps jsdom cannot cover: cross-origin
> postMessage, origin checks, cross-iframe theming, and the real payment flow.

---

## 1. Purpose and scope

The subject under test is the **public SDK contract** (see `js/src/index.ts`
exports):

- Entry: `createCheckout(options)` → `CheckoutInstance`; the IIFE build mounts
  `window.SunbayCheckout`.
- `CheckoutInstance`: `create` / `confirm` / `getSession` / `refresh` /
  `getPaymentStatus` / `updateCheckout` / `on` / `off` / `destroy`.
- `CheckoutElement`: `mount` / `unmount` / `destroy` / `update` / `on` / `off` /
  `focus` / `blur` / `clear` (input types only) / `getAvailableWallets` (express
  only).
- Element types (embedding modes): `card` / `cardNumber` / `cardExpiry` /
  `cardCvc` / `address` / `expressCheckout`.
- Theming: `appearance.colorScheme` (light/dark/auto), `appearance.variables`
  (7 whitelisted design variables), `appearance.rules` (7 semantic targets);
  both the init path (iframe src, no-flash first paint) and the runtime path
  (`updateCheckout`).
- Wallet button customization: `expressCheckout` per-wallet `buttonTheme` /
  `buttonType` and global `buttonHeight`, plus wallet toggles.
- Events: `ready` / `change` / `focus` / `blur` / `loadError` / `elementReady` /
  `expressAvailabilityChange` / `paymentStateChange` / `paymentResult` / `error`.
- The cross-cutting security invariant (PCI): **card data never crosses the SDK
  / parent window / postMessage channel**; card values are RSA-encrypted locally
  inside the hosted iframe and sent directly to the backend.

**Out of scope** (covered by existing unit tests): exhaustive value-by-value
mapping of wallet `buttonType` / `buttonTheme` (`parseExpressOptions` /
`resolveWalletButtonTheme`), pure utility functions, and every branch of the
appearance whitelist validators. Real-device tests only verify that config is
correctly passed through and takes effect in a real iframe.

---

## 2. Three-layer architecture (real-environment simulation)

Real-device tests use a "three roles, three origins" real cross-origin model.
The test infrastructure is self-contained in this `test-e2e/` directory.

```
Test harness page            Test backend                 Sunbay platform + hosted runtime
  standard merchant-page        creates sessions with         create-session API / /embed/sdk/main
  simulator                     the sandbox merchant key       /embed/sdk/field/* /embed/sdk/element/*
  standalone origin (:8090)     /api/create-session           (hosted runtime, default :3000)
        |                          |  (key stays server-side)            |
        | (1) POST /api/create-session                                   |
        |------------------------->|                                     |
        |                          | (2) create session w/ key --------->|
        | (3) { sessionId } <-------|<------------ { sessionId } ---------|
        |                                                                |
        | (4) window.__sunbayHarness.setup(case config)                  |
        |      -> createCheckout({ sessionId, hostOrigin })              |
        |      -> hidden main iframe + visible field/element iframes      |
        |         (all hosted by the runtime)                            |
        | (5) browser automation drives + reads events/parentMessages/DOM |
        v
   (card values exist only inside the hosted iframes; the parent/SDK never touch them)
```

The three origins must be **mutually non-same-origin** to genuinely cover
cross-origin postMessage, `event.origin` checks, and cross-iframe channels:

- Test harness page + test backend: same origin (default `http://localhost:8090`).
- Hosted runtime: a different origin (default `http://localhost:3000`, i.e. the
  `checkout` repo's `npm run dev`; or a deployed real environment).

> Why not verify this inside the `checkout` repo: the hosted page and a real
> merchant page are **not same-origin**. Only a standalone-origin harness can
> genuinely exercise the SDK's cross-origin behavior — which is why the harness
> must exist independently.

---

## 3. Prerequisites

1. **Hosted runtime reachable**, serving `/embed/sdk/main`, `/embed/sdk/field/<type>`,
   `/embed/sdk/element/<type>`. Locally use the `checkout` repo's `npm run dev` (:3000);
   or point at a deployed environment. The runtime also keeps a legacy `/sdk/*` alias
   (used by SDK <= 0.0.5); the SDK under test loads `/embed/sdk/*` only.
   > Long-running processes (dev server) are started manually by the user; the
   > test runner does not start them in the background.
2. **SDK IIFE build present**: `js/dist/index.global.js`
   (`pnpm --filter @sunbay/checkout-sdk-js run build`). The harness loads the
   **real published artifact** (not source), so it tests the shipped form.
3. **Test backend can create sandbox sessions**: `test-e2e/server` holds the
   **sandbox merchant credentials** and exposes `POST /api/create-session`
   returning a `sessionId`. Credentials stay on the server, read from `.env.local`
   (git-ignored); the browser never sees them.
4. **Sandbox test cards** for functional tests: see `fixtures/test-cards.ts`
   (public test data, plaintext).

---

## 4. Execution model (for AI-driven runs)

Each case is a **structured entry** (template in `test-cases.md` §1) that maps
directly to a browser-automation run:

- `harness-config` → call `window.__sunbayHarness.setup(config)` to build the
  scenario declaratively.
- `steps` → ordered browser actions (navigate / fill / click / call hook methods).
- `expected` / `assertions` → read `__sunbayHarness.events`,
  `__sunbayHarness.parentMessages`, `instance` / `elements` state, and
  DOM/computed styles via `evaluate_script` to decide pass/fail.
- `cleanup` → call `destroy()` / `reset()` to reset, ensuring no cross-case state.

**Card entry** (for payment-flow cases) does **not** go through the hooks: the
browser automation types directly into the hosted `cardNumber` / `cardExpiry` /
`cardCvc` iframes (cross-iframe); the harness only provides container anchors.
Assertions then verify the parent window's `parentMessages` / `events` contain
no card number.

---

## 5. Priority and condition markers

Each case carries the following markers for tiered orchestration and auto-skip.

**Priority**

| Level | Meaning | Suggested orchestration |
|---|---|---|
| P0 | Core public capability; must pass on release | Every regression run |
| P1 | Important capability / common combination | Every regression run |
| P2 | Edge / enhancement / less common | Full regression; may skip on quick runs |

**Real-device condition** — marks a case's dependency on a special environment;
when unmet it is **skipped as expected, not failed**:

| Marker | Meaning | Expected when unmet |
|---|---|---|
| `none` | A plain browser suffices | — |
| `requires-apple-pay` | Safari + Apple device + backend Apple certs/domain verification | Button not rendered, `availableWallets.applePay=false` is expected |
| `requires-google-pay` | HTTPS test domain + Google test merchant config | Button not rendered, `availableWallets.googlePay=false` is expected |
| `requires-blackhole` | An unreachable hostOrigin that never replies with hello (e.g. `http://127.0.0.1:59999`) | — |
| `requires-stub-runtime` | The `test-e2e/` stub hello endpoint (replies with a RuntimeHello that excludes the current PROTOCOL_MAJOR) | Without the stub the case leaves real-device scope and is covered by unit tests |
| `requires-session-variant` | Ability to create a session with a specific flag (e.g. `collectShippingAddress:true`) | When the sandbox cannot control it, degrade to "assert session-view field pass-through only" |
| `requires-payment-flow` | A real payment flow through the hosted runtime (sandbox) | — |

**Optional set**: error-path cases (`PROTOCOL_UNSUPPORTED` / `RUNTIME_LOAD_FAILED`)
and the actual-wallet-invocation case are grouped as optional; a daily automated
regression may skip them by marker and orchestrate them separately.

---

## 6. Directory contents

| File | Description |
|---|---|
| `README.md` | This file: purpose, three-layer architecture, prerequisites, execution model, markers |
| `harness-design.md` | Harness page + `window.__sunbayHarness` hook contract, assertion data sources, cross-origin rules, card-entry convention, stub/backend conventions |
| `test-cases.md` | 46 structured cases (C1–C7) + unified template + cross-cutting PCI assertion |
| `RUNNING.md` | How to run: start services, run full/by-priority/single, read results, AI loop |
| `fixtures/test-cards.ts` | Sandbox test cards (public functional-test data) |
| `server/` | Test backend + optional stub runtime |
| `harness/` | Harness page + `window.__sunbayHarness` implementation |
| `support/` | Playwright-side driver, PCI scan, card-entry helpers, skip conditions |
| `tests/` | The 46 executable Playwright specs (one test per case) |
