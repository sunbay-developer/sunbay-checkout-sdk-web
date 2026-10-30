# AGENTS.md — checkout-sdk-web

This file provides project information, architectural constraints, and workflow
rules for all AI agents working in the `checkout-sdk-web` repository. **Read it
in full before starting any task, and follow it strictly.**

> This repository is the standalone git repo for the public **Web** SDK. It sits
> **alongside but separate from** the consumer `checkout` (Next.js hosted
> runtime). Changes here must not directly modify the `checkout` repo.
> **Native SDKs (react-native / ios / android) are not in this repo**: they are
> maintained in their own repositories (planned). This repo covers Web only
> (protocol + js [+ react]).

---

## 1. Repository overview

This repository is itself a **pnpm workspace** (workspace root = repo root:
`package.json` + `pnpm-workspace.yaml`).

```
checkout-sdk-web/
├── protocol/   → @sunbay/checkout-sdk-protocol   # SDK ↔ hosted-runtime protocol contract (single source of truth)
├── js/         → @sunbay/checkout-sdk-js          # Merchant-facing browser JS SDK (createCheckout entry point)
├── react/      → @sunbay/checkout-sdk-react       # Browser React SDK (planned, placeholder)
└── docs/       → plans / specs
```

- `react/` currently contains only `.gitkeep`, is **not implemented**, and is
  **not** part of the workspace; do not invent its contents in docs or code.
- Default branch is `main`.

---

## 2. Architectural constraints (understand these first)

- **Protocol source of truth** = `protocol/src/` (package
  `@sunbay/checkout-sdk-protocol`). The protocol is the single contract between
  the SDK and the hosted runtime, with **zero reverse dependencies** (protocol
  depends on neither js nor runtime).
- There are two kinds of consumers:
  - `js` (`@sunbay/checkout-sdk-js`) — **same repo**, consumes protocol via the
    pnpm workspace local link (`workspace:*`) during development.
  - `checkout` (`src/sdk-runtime`) — **cross-repo**, can only consume the
    **published npm package** `@sunbay/checkout-sdk-protocol`; it cannot join
    this workspace.
  - Native SDKs (separate repos) — if they talk to the hosted runtime, they must
    also honor the protocol version `PROTOCOL_MAJOR` and the security
    constraints, consuming the published protocol package (or an equivalent
    contract in their language).
- **The real compatibility boundary is the runtime protocol version
  `PROTOCOL_MAJOR` (checked at handshake), not the npm version number.** The SDK
  and runtime deploy independently and their live versions may differ; breaking
  protocol changes **must bump major** and reject incompatible peers at the
  handshake.
- **Security constraint (PCI)**: the protocol envelope and every SDK layer
  **never carry card data** (plaintext or ciphertext). Card data is encrypted
  locally with an RSA public key only inside the hosted-runtime page and sent
  directly to the backend.
- **English-only code (mandatory)**: all code in this repo — identifiers, **comments,
  JSDoc, test `describe`/`it` descriptions, and in-code strings** — **must be in
  English**. This SDK is an outward-facing published package; Chinese is not
  allowed in `protocol/` and `js/` sources/tests/config. Exceptions: Markdown
  docs (`docs/`, `*.md`, specs) are not bound by this rule. The `test-e2e/`
  suite is test infrastructure (not published) and also uses English code and
  comments. When editing or adding code, write English
  comments/JSDoc; do not introduce Chinese. Quick residual check:
  `grep -rl $'[\u4e00-\u9fff]' protocol/src js/src js/test` should return nothing.

### Historical note (deprecated)
Early on, `protocol/scripts/sync-protocol.mjs` copied the protocol source into
two in-repo copies to work around Turbopack's handling of out-of-repo symlinks.
Once the protocol was published to npm, that script and the copies were removed
in favor of a package dependency + workspace local link. **Do not reintroduce
source copies or the sync script.**

---

## 3. Development workflow (pnpm workspace)

This repo uses **pnpm** (9+ recommended). Run all commands from the **repo root**.

```bash
pnpm install                 # install deps; generates pnpm-lock.yaml, symlinks protocol into js

# Aggregate scripts (root package.json)
pnpm run build               # build protocol first, then js (order matters)
pnpm run type-check          # type-check each package recursively
pnpm run test                # test each package recursively

# Per-package filters
pnpm --filter @sunbay/checkout-sdk-protocol run build
pnpm --filter @sunbay/checkout-sdk-js run type-check
pnpm --filter @sunbay/checkout-sdk-js run test
pnpm --filter @sunbay/checkout-sdk-js run build
```

- **Local integration**: `js` depends on
  `@sunbay/checkout-sdk-protocol: "workspace:*"`, always pointing to the local
  `protocol`. Change the protocol → `build protocol` → js picks it up
  immediately, **no npm publish, no npm link**.
- **Build order**: `js` type-check/build depends on protocol's `dist` (types and
  artifacts). CI/scripts must build protocol first.
- **Long-running processes** (watch / dev) are started manually by the user; the
  agent must not start them in the background.

---

## 4. Publishing / versioning (semver + PROTOCOL_MAJOR)

- The two packages `@sunbay/checkout-sdk-protocol` / `@sunbay/checkout-sdk-js`
  publish to the official registry (`https://registry.npmjs.org`), both with
  `publishConfig.access = public`. Published history: 0.0.1 (protocol) → **0.0.2
  (both, lockstep)**.
- **Lockstep versioning (mandatory)**: the two packages **always share the same
  version number**. When either package is released, both are bumped to the same
  version and published together (a package with no changes still gets bumped
  along). Benefit: you only have to remember one version, `js@x ⇄ protocol@x` is
  obvious at a glance, and js's `dependencies` always pins the same-version
  protocol.
- **One-command release (fixed script)**: `pnpm release <version>` (=
  `bash scripts/release.sh`). The script automatically: bumps both package
  versions → build → type-check + test gate → publish. Protocol first, then js.
  Dry-run: `pnpm release <version> --dry-run` (build + pack validation only, no
  actual publish; it temporarily edits the package.json versions, then restore
  them afterward with `git checkout protocol/package.json js/package.json`).
  Optional `--tag <name>` (any order with `--dry-run`, after the version) passes
  `--tag <name>` to `npm publish`; omitted = default `latest`. Recommended
  two-step rollout: publish with `--tag next`, then after the hosted runtime is
  deployed promote with `npm dist-tag add <pkg>@<version> latest --registry
  https://registry.npmjs.org` (for both packages). Dry-run prints the exact
  token-less publish command.
  Manual follow-up after release: git commit the version changes in both packages
  and push; in the `checkout` repo bump the dependency to `^<version>` +
  `npm install` to lock the lockfile.
- **Correct publishing procedure (the script wraps this; when publishing by hand
  you must follow it exactly, otherwise it will fail)**:
  - **Do not run `pnpm publish` directly**: this machine's global `~/.npmrc` has
    `registry` pointing at the Taobao mirror (`registry.npmmirror.com`,
    read-only), so `pnpm publish` would wrongly target the mirror and return
    401/404.
  - **Do not run `npm publish` directly (for js)**: js depends on
    `@sunbay/checkout-sdk-protocol: workspace:*`, and `npm publish` does not
    replace `workspace:*`, so a merchant's `npm install` cannot resolve it.
  - **Correct approach = `pnpm pack` + `npm publish <tarball>`**: `pnpm pack`
    automatically replaces `workspace:*` with the actual published version and
    produces a tarball; then publish that tarball with explicit arguments:
    `npm publish <tgz> --registry https://registry.npmjs.org --//registry.npmjs.org/:_authToken="$SUNBAY_NPM_TOKEN" --access public`.
    (The protocol may take a few minutes to appear in `npm view` due to index
    propagation delay; this is normal.)
- **semver discipline**:
  - Any **breaking protocol change** in protocol (removing/altering envelope
    fields, commands, events, or error-code semantics) → **bump major** and bump
    `PROTOCOL_MAJOR` in sync; the runtime handshake rejects incompatible peers.
  - Backward-compatible additions → minor; fixes/docs → patch.
  - During the early 0.0.x phase, a lockstep patch bump is enough; runtime
    compatibility is ultimately decided by the handshake `PROTOCOL_MAJOR`.
- **Publishing token**: environment variable `SUNBAY_NPM_TOKEN` (granular token,
  Read and write + Bypass 2FA). **Never print, commit, or write the token value
  into the repo/logs.** The script passes it via the command-line
  `--//registry.npmjs.org/:_authToken=` argument and never persists an `.npmrc`
  (if you write one temporarily, delete it immediately after publishing).
- **Cross-repo `checkout` always consumes the published registry package** (not
  a symlink), which is safest for Turbopack. After publishing a new version,
  `checkout` must bump the dependency range + `npm install --registry
  https://registry.npmjs.org` (bypassing the mirror) to lock the lockfile, so
  that CI / clean environments can install it with `npm ci`.

### Local on-device (real-device) testing

Real-device tests live in [`test-e2e/`](./test-e2e/README.md) (Playwright). They
drive the published SDK build inside a standalone merchant-page harness against
the hosted runtime, covering embedding modes, element combinations / mutual
exclusion, theming (colorScheme / appearance.variables / appearance.rules, both
at init and runtime), express wallet options, the card payment flow, and the PCI
card-isolation invariant.

```bash
# 1) checkout hosted runtime (separate terminal; the agent does not start long-running processes)
cd ../checkout && npm run dev            # :3000
# 2) build the SDK artifacts the harness loads (IIFE dist/index.global.js)
pnpm --filter @sunbay/checkout-sdk-js run build
# 3) configure sandbox credentials (first time): cp test-e2e/.env.example test-e2e/.env.local and fill them in
# 4) run the suite (the test backend on :8090 is auto-started by Playwright)
pnpm test:e2e                            # or, inside test-e2e/, pnpm test / test:p0 / --grep ...
```

The cross-origin setup (:3000 hosted vs :8090 merchant-page harness) genuinely
exercises the SDK's postMessage / origin validation / cross-iframe channels.
See `test-e2e/RUNNING.md` for priority/condition filtering and the AI regression
loop.

---

## 5. Git conventions

- Standalone git repo, default branch `main`. **Do not develop directly on
  `main`**; open `feature/<scope>`, `fix/<scope>`, or `chore/<scope>` branches
  per team conventions.
- Do not commit unless the user explicitly asks; when committing, `git add`
  precise files — **never `git add .`**.
- Files that may contain secrets (`.env*`, credentials, token-bearing npmrc)
  **must not be committed**.
- Push the working branch by default; do not push directly to `main`.

---

## 6. Sub-package doc index

| Sub-package | AGENTS.md |
|---|---|
| Protocol contract (source of truth) | `protocol/AGENTS.md` |
| Browser JS SDK | `js/AGENTS.md` |
| React SDK (placeholder) | `react/AGENTS.md` |
| Execution plan / spec | `docs/sdk-workspace-publish-plan.md` |
