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
  publish independently to the official registry, both with
  `publishConfig.access = public`.
- **semver discipline**:
  - Any **breaking protocol change** in protocol (removing/altering envelope
    fields, commands, events, or error-code semantics) → **bump major** and bump
    `PROTOCOL_MAJOR` in sync; the runtime handshake rejects incompatible peers.
  - Backward-compatible additions → minor; fixes/docs → patch.
  - The npm version aids dependency management, but **runtime compatibility is
    governed by the handshake `PROTOCOL_MAJOR`**.
- **Publishing token**: environment variable `SUNBAY_NPM_TOKEN` (granular token,
  Read and write + Bypass 2FA). **Never print, commit, or write the token value
  into the repo/logs.**
- **Cross-repo `checkout` always consumes the published registry package** (not
  a symlink), which is safest for Turbopack.

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
