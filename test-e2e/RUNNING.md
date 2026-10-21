# Running guide (RUNNING.md)

> How to start the environment, run the real-device e2e suite, read results, and
> the AI regression loop. For the spec see `README.md` / `harness-design.md` /
> `test-cases.md`.

---

## 1. One-time setup

```bash
# From the SDK repo root (checkout-sdk-web/), install workspace deps (incl. test-e2e)
pnpm install

# Build the SDK IIFE artifact (the harness loads js/dist/index.global.js via <script>)
pnpm --filter @sunbay/checkout-sdk-js run build

# Install the Playwright browser (Chromium)
pnpm --filter @sunbay/checkout-sdk-e2e run install:browsers
```

Configure the sandbox merchant credentials (needed for real session creation;
session-dependent cases auto-skip when absent):

```bash
cd test-e2e
cp .env.example .env.local
# Edit .env.local: fill in sandbox API_KEY / APP_ID / MERCHANT_ID
```

> `.env.local` is in `.gitignore` and is never committed. The credentials are
> used only on the test backend server side and never reach the browser.
> `server/server.mjs` loads `.env.local` first.

---

## 2. Start dependencies

Real-device e2e needs two origins:

| Service | Default | Who starts it |
|---|---|---|
| hosted runtime (checkout repo) | `http://localhost:3000` | Manually: `npm run dev` in the checkout repo |
| test backend + harness page | `http://localhost:8090` | **Playwright starts it automatically** (`webServer`); or manually `pnpm --filter @sunbay/checkout-sdk-e2e run server` |

Check the hosted runtime is up:

```bash
curl -s http://localhost:3000/healthz   # expect 200
```

> If hosted is down, session/mount cases fail (not skip). The error-path case
> C1-04 uses an unreachable port and does not depend on hosted.
> Port 8090 may be in use; to change it set `E2E_HARNESS_ORIGIN` and the backend
> `PORT` (see `.env.example`).

Optional stub (only for C1-03 PROTOCOL_UNSUPPORTED):

```bash
pnpm --filter @sunbay/checkout-sdk-e2e run stub   # http://localhost:8099
```

---

## 3. Run the tests

```bash
cd test-e2e

# All 46 cases
pnpm test

# By priority (tag filter)
pnpm test:p0            # P0 only (smoke / must-pass on release)
pnpm test:p1            # P1 only
pnpm exec playwright test --grep @p2
pnpm exec playwright test --grep @c4         # a single category (C1..C7)
pnpm exec playwright test --grep-invert @optional   # exclude the optional set (error paths / wallet invoke)

# A single case (by title keyword)
pnpm exec playwright test --grep "C2-02"

# A single file
pnpm exec playwright test tests/c4-theming.spec.ts

# Browser visibility — runs HEADED by default so you can observe. For CI:
E2E_HEADLESS=1 pnpm test
# Adjust the headed slow-motion (ms) with E2E_SLOWMO (default 250)
E2E_SLOWMO=0 pnpm test
```

Auto-skip logic:
- No sandbox credentials → all session-dependent cases **skip** (credential-free
  cases such as C1-02 still run).
- No stub runtime → C1-03 **skips**.
- No Apple/Google Pay capable environment → C6-05 **skips** (wallet unavailable
  is expected).

---

## 4. Read results

- **Terminal**: the `list` reporter prints each pass/skip/fail live.
- **HTML report**: `pnpm --filter @sunbay/checkout-sdk-e2e run report` (opens
  `playwright-report/`). Failures attach trace / screenshot / video.
- **Machine-readable JSON**: `playwright-report/results.json` (for an AI to parse
  per-case results and locate failures).

---

## 5. AI regression loop

This suite is designed as an AI-driven regression loop:

1. **Run**: `pnpm test` (or tiered `--grep @p0`), read `playwright-report/results.json`.
2. **Interpret**: locate pass/fail/skip by case id (C1-01…C7-10); for failures,
   read the trace/screenshot/assertion error.
3. **Attribute**:
   - Assertion failure → SDK/hosted behavior diverges from spec → map to the
     case's expected/assertions in `test-cases.md`.
   - Skip → an environment condition is unmet (credentials/stub/wallet), not a defect.
4. **Fix**: change the SDK (`js/src`) or hosted (`checkout` repo `src/sdk-runtime`),
   rebuild the artifact.
5. **Re-test**: re-run the case (`--grep "C4-03"`) → green → expand to the
   category → full regression.

**When adding an SDK feature**:
1. Add a structured case to `test-cases.md` (same template + markers).
2. Add a `test(... @pX @cN ...)` to the matching `tests/c*-*.spec.ts`, adding
   hooks/helpers in `harness.mjs` / `support/harness.ts` if needed.
3. Run the new case → green → fold into regression.

This closes the loop: feature → case → real-device test → AI finds defect → fix
→ re-test.

---

## 6. Directory layout

```
test-e2e/
├── README.md               Spec overview, three-layer architecture, markers
├── harness-design.md       Harness hook contract, assertion data sources, cross-origin rules
├── test-cases.md           46 structured cases (blueprint)
├── RUNNING.md              This file
├── package.json            @sunbay/checkout-sdk-e2e (workspace package, not published)
├── playwright.config.ts    Auto-starts the test backend, reporters, timeouts, headed default
├── tsconfig.json
├── .env.example            Credentials template (copy to .env.local)
├── server/
│   ├── server.mjs          Test backend: create-session + static serve harness/dist + /healthz
│   └── stub-runtime.mjs    Optional fake hello endpoint (PROTOCOL_UNSUPPORTED)
├── harness/
│   ├── harness.html        Harness page (slot containers + loads the SDK IIFE)
│   └── harness.mjs         window.__sunbayHarness implementation
├── fixtures/
│   └── test-cards.ts       Sandbox test cards
├── support/
│   ├── env.ts              Origin resolution + health probe + skip conditions
│   └── harness.ts          Playwright-side driver + PCI scan + card-entry helpers
└── tests/
    ├── c1-handshake.spec.ts            C1 (5)
    ├── c2-embedding.spec.ts            C2 (6)
    ├── c3-combination.spec.ts          C3 (9)
    ├── c4-theming.spec.ts              C4 (6)
    ├── c5-element-customization.spec.ts C5 (5)
    ├── c6-wallet-buttons.spec.ts       C6 (5)
    └── c7-payment-lifecycle.spec.ts    C7 (10)
```
