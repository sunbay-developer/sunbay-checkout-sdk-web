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
  publish to the official registry (`https://registry.npmjs.org`), both with
  `publishConfig.access = public`. Published history: 0.0.1 (protocol) → **0.0.2
  (both, lockstep)**.
- **Lockstep versioning（强制）**：两包**始终同版本号**。任一包发版时两包一起升到同一
  版本并同时发布（即使某包无改动也陪升）。好处：心智只记一个版本，`js@x ⇄ protocol@x`
  一目了然；js 的 `dependencies` 固定引用同版本 protocol。
- **一键发布（固化脚本）**：`pnpm release <version>`（= `bash scripts/release.sh`）。
  脚本自动：两包升版本 → build → type-check+test 门禁 → 发布。先 protocol 后 js。
  dry-run：`pnpm release <version> --dry-run`（只 build+pack 校验，不实发；会临时改 package.json
  版本，之后 `git checkout protocol/package.json js/package.json` 还原）。
  发布后手动收尾：git 提交两包版本改动并 push；到 `checkout` 仓 bump 依赖 `^<version>` +
  `npm install` 锁 lockfile。
- **发布实操正解（脚本已封装，手动发时务必照此，否则必失败）**：
  - **不要直接 `pnpm publish`**：本机全局 `~/.npmrc` 的 `registry` 指向淘宝镜像
    （`registry.npmmirror.com`，只读），`pnpm publish` 会误发到镜像并 401/404。
  - **不要直接 `npm publish`（对 js）**：js 依赖 `@sunbay/checkout-sdk-protocol: workspace:*`，
    `npm publish` 不会替换 `workspace:*`，商户 `npm install` 解析不了。
  - **正解 = `pnpm pack` + `npm publish <tarball>`**：`pnpm pack` 自动把 `workspace:*`
    替换为已发布的实际版本并生成 tarball；再用显式参数发布该 tarball：
    `npm publish <tgz> --registry https://registry.npmjs.org --//registry.npmjs.org/:_authToken="$SUNBAY_NPM_TOKEN" --access public`。
    （协议 npm view 可能有几分钟索引传播延迟，属正常。）
- **semver discipline**:
  - Any **breaking protocol change** in protocol (removing/altering envelope
    fields, commands, events, or error-code semantics) → **bump major** and bump
    `PROTOCOL_MAJOR` in sync; the runtime handshake rejects incompatible peers.
  - Backward-compatible additions → minor; fixes/docs → patch.
  - 0.0.x 早期阶段 lockstep patch 递增即可；runtime 兼容最终由握手 `PROTOCOL_MAJOR` 裁决。
- **Publishing token**: environment variable `SUNBAY_NPM_TOKEN` (granular token,
  Read and write + Bypass 2FA). **Never print, commit, or write the token value
  into the repo/logs.** 脚本用命令行 `--//registry.npmjs.org/:_authToken=` 传入，
  绝不持久化 `.npmrc`（若临时写了务必发布后立即删）。
- **Cross-repo `checkout` always consumes the published registry package** (not
  a symlink), which is safest for Turbopack. 发布新版本后，`checkout` 需 bump 依赖
  范围 + `npm install --registry https://registry.npmjs.org`（绕镜像）锁 lockfile，
  CI/干净环境 `npm ci` 才能装到。

### 本地真机联调（playground / demo）

`pnpm dev:playground`（= `bash scripts/dev-playground.sh`）构建 SDK 产物（含 IIFE
`dist/index.global.js`，供 demo 的 `<script>` 引入）。另两个长驻进程手动起（Agent 不起长驻进程）：

```bash
# 1) checkout hosted（另一终端）
cd ../checkout && npm run dev            # :3000
# 2) 构建 SDK 产物
pnpm dev:playground
# 3) demo server（另一终端；首次 cp js/examples/.env.example .env.local 填凭据）
cd js/examples && node server.mjs        # :8080
# 打开 http://localhost:8080/examples/customization-playground.html
```

定制 playground 覆盖全部主题定制真机验证：colorScheme / appearance.variables /
appearance.rules / 钱包按钮 buttonTheme·buttonType·buttonHeight。跨源（:3000 hosted
vs :8080 商户页）真实覆盖 SDK 的 postMessage / origin 校验。

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
