# AGENTS.md — checkout-sdk-web

本文件为在 `checkout-sdk-web` 仓库内工作的所有 AI Agent 提供项目信息、架构约束与工作流规范。**动手前请完整阅读本文件，并严格遵循。**

> 本仓库是对外 **Web** SDK 的独立 git 仓库，与消费方 `checkout`（Next.js hosted runtime）**同级但分仓**。本仓库的改动不应直接修改 `checkout` 仓库。
> **Native SDK（react-native / ios / android）不在本仓库**：它们由各自独立的仓库维护（规划中），本仓库只负责 Web（protocol + js [+ react]）。

---

## 1. 仓库概览

本仓库自身就是一个 **pnpm workspace**（workspace 根 = 仓库根：`package.json` + `pnpm-workspace.yaml`）。

```
checkout-sdk-web/
├── protocol/   → @sunbay/checkout-sdk-protocol   # SDK ↔ hosted runtime 通信协议契约（单一真源）
├── js/         → @sunbay/checkout-sdk-js          # 面向商户的浏览器 JS SDK（createCheckout 入口）
├── react/      → @sunbay/checkout-sdk-react       # 浏览器 React SDK（规划中，占位目录）
└── docs/       → 计划 / 规格文档
```

- `react/` 目前仅含 `.gitkeep`，**尚未实现**，也**未**纳入 workspace；写文档或代码时不要编造其内容。
- 仓库默认分支 `main`。

---

## 2. 架构约束（务必先懂）

- **协议真源** = `protocol/src/`（包 `@sunbay/checkout-sdk-protocol`）。协议是 SDK 与 hosted runtime 之间的单一契约，**零反向依赖**（protocol 不依赖 js / runtime）。
- 消费方有两类：
  - `js`（`@sunbay/checkout-sdk-js`）——**同仓**，开发期通过 pnpm workspace 本地链接（`workspace:*`）消费 protocol。
  - `checkout`（`src/sdk-runtime`）——**跨仓**，只能通过**已发布的 npm 包** `@sunbay/checkout-sdk-protocol` 消费，无法进本 workspace。
  - Native SDK（独立仓库）——若与 hosted runtime 通信，同样须遵循协议版本 `PROTOCOL_MAJOR` 与安全约束；它们通过已发布的协议包（或各自语言的等价契约）消费。
- **真正的兼容性边界是运行时协议版本 `PROTOCOL_MAJOR`（握手时校验），不是 npm 版本号。** SDK 与 runtime 独立部署、线上版本可能不一致；协议破坏性变更**必须升 major**，并在握手处拒绝不兼容的对端。
- **安全约束（PCI）**：协议信封与 SDK 各层**绝不搬运卡值**（明文或密文）。卡数据只在 hosted runtime 页面内用 RSA 公钥本地加密并直连后端。

### 历史背景（已废弃）
早期用 `protocol/scripts/sync-protocol.mjs` 把协议源码拷贝到两仓副本，以规避 Turbopack 对仓外 symlink 的解析问题。协议发布 npm 后，该脚本与副本均已删除，改为包依赖 + workspace 本地链接。**不要重新引入源码副本或 sync 脚本。**

---

## 3. 开发工作流（pnpm workspace）

本仓库使用 **pnpm**（建议 9+，本机验证于 12.14.0）。所有命令在**仓库根**执行。

```bash
pnpm install                 # 安装依赖；生成 pnpm-lock.yaml，protocol 本地 symlink 到 js

# 聚合脚本（根 package.json）
pnpm run build               # 先 build protocol，再 build js（顺序不可颠倒）
pnpm run type-check          # 递归 type-check 各包
pnpm run test                # 递归 test 各包

# 单包过滤
pnpm --filter @sunbay/checkout-sdk-protocol run build
pnpm --filter @sunbay/checkout-sdk-js run type-check
pnpm --filter @sunbay/checkout-sdk-js run test
pnpm --filter @sunbay/checkout-sdk-js run build
```

- **本地联调**：`js` 依赖 `@sunbay/checkout-sdk-protocol: "workspace:*"`，始终指向本地 `protocol`。改协议 → `build protocol` → js 立即生效，**无需发 npm、无需 npm link**。
- **构建顺序**：`js` 的 type-check/build 依赖 protocol 的 `dist`（类型与产物）。CI / 脚本须保证 protocol 先 build。
- **esbuild 构建脚本**：首次安装时 pnpm 会拦截 esbuild 的 postinstall；本仓库已在 `pnpm-workspace.yaml` 的 `allowBuilds` 中批准（`esbuild: true`）。该 postinstall 实际无副作用（原生二进制经 `@esbuild/darwin-arm64` 等可选依赖提供）。若在新机器上又出现 `ERR_PNPM_IGNORED_BUILDS`，运行 `pnpm approve-builds esbuild --yes`。
- **长时进程**（watch / dev）由用户手动运行，Agent 不要后台启动。

---

## 4. 发布 / 版本（semver + PROTOCOL_MAJOR）

- 两个包 `@sunbay/checkout-sdk-protocol` / `@sunbay/checkout-sdk-js` 独立发布到官方 registry，均为 `publishConfig.access = public`。
- **semver 纪律**：
  - protocol 的任何**破坏性协议变更**（删/改信封字段、命令、事件、错误码语义）→ **升 major**，并同步 `PROTOCOL_MAJOR`，在握手校验处拒绝不兼容对端。
  - 向后兼容的新增 → minor；修订/文档 → patch。
  - npm 版本号便于依赖管理，但**运行时兼容性以握手的 `PROTOCOL_MAJOR` 为准**。
- **pnpm 发布**：在包目录 `pnpm build && pnpm publish --access public --no-git-checks`。pnpm 会把 `workspace:*` 自动替换为真实版本号写入发布 tarball。可用 `pnpm -r publish` 批量。
- **发布令牌**：环境变量 `SUNBAY_NPM_TOKEN`（granular token，权限 Read and write + Bypass 2FA）。
  - **切勿打印、提交或写入仓库/日志中的 token 值。**
  - 临时 npmrc 写法（勿落盘到仓库）：`//registry.npmjs.org/:_authToken=${SUNBAY_NPM_TOKEN}`。
  - 发布后 `npm view <pkg> version` 确认（registry 同步有几分钟延迟属正常）。
- **跨仓 checkout 永远走已发布的 registry 包**（非 symlink），这对 Turbopack 最安全。
- **未来方向**：2027 起 npm 废弃 token 直接 publish，届时迁 Trusted Publishing（GitHub Actions + OIDC，带 provenance、无长期 token）。

---

## 5. Git 规范

- 独立 git 仓库，默认分支 `main`。**不要直接在 `main` 上开发**；按团队规范开 `feature/<scope>`、`fix/<scope>`、`chore/<scope>` 分支。
- 不要在用户未明确要求时提交；提交时 `git add` 精确到文件，**不要 `git add .`**。
- 可能含密钥的文件（`.env*`、凭证、含 token 的 npmrc）**不得提交**。
- 默认推工作分支，不直推 `main`。

---

## 6. 子包文档索引

| 子包 | AGENTS.md |
|---|---|
| 协议契约真源 | `protocol/AGENTS.md` |
| 浏览器 JS SDK | `js/AGENTS.md` |
| React SDK（占位） | `react/AGENTS.md` |
| 执行计划 / 规格 | `docs/sdk-workspace-publish-plan.md` |
