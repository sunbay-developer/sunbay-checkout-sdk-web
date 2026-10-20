# SDK Workspace 化 / 发布 / 文档 计划（spec）

> 本文件是「后续单独处理」的执行清单。记录**已完成事实**、**待办步骤**、**验证标准**、**回滚方式**。
> 主线按 **pnpm** 推荐路径写；若暂留 npm 另有兼容说明。
>
> 涉及两个独立仓库：
> - `checkout-sdk-web/`（Web SDK monorepo，本仓库；原名 `checkout-sdk`，已重命名并把原 `web/` 层提到仓库根）
> - `checkout/`（Next.js hosted runtime，消费方，另一个仓库，**本计划基本不改它**）
>
> **结构变更（2026-10）**：仓库 `checkout-sdk` → `checkout-sdk-web`，原 `web/{protocol,js,react}` 提层为仓库根下的 `protocol/ js/ react/`，workspace 根即仓库根。`native/`（react-native/ios/android）已移出本仓库，Native SDK 由各自独立仓库维护（规划中）。本文内历史命令里的 `cd web`、`checkout-sdk/web/...` 等旧路径，按新布局理解为仓库根 / `checkout-sdk-web/...`。

---

## 0. 背景 / 架构约束（务必先懂）

- **协议真源** = `protocol/src/`（包 `@sunbay/checkout-sdk-protocol`）。
- 消费方：
  - `js`（包 `@sunbay/checkout-sdk-js`）——**同仓**，开发期应走 workspace 本地链接。
  - `checkout`（`src/sdk-runtime`）——**跨仓**，只能通过**已发布的 npm 包**消费，无法进 workspace。
- **真正的兼容性边界是运行时协议版本 `PROTOCOL_MAJOR`（握手时校验），不是 npm 版本号。** SDK 与 runtime 独立部署、线上版本可能不一致，协议破坏性变更必须升 major 并在握手处拒绝不兼容。
- 历史背景：当初用 `sync-protocol.mjs` 把协议源码拷贝到两处副本，是为规避 **Turbopack 对仓外 symlink 的解析问题**。现协议已发 npm，副本已删除，改为包依赖。

---

## 1. 已完成的事实（截至本文件生成）

**发布**
- `@sunbay/checkout-sdk-protocol@0.0.1` 已发布到官方 registry，`npm view` 可见。
- `@sunbay/checkout-sdk-js` **尚未发布**（已更名、去 private、version 0.0.1、加 publishConfig.access=public）。

**js（已改为依赖 protocol 包，验证通过）**
- 删除 `src/protocol/` 本地副本。
- `src/`（createCheckout/Element/CheckoutInstance/index）+ `src/transport/MainFrameTransport.ts` + `test/`（element/instance/protocol/transport 4 个）的 import 改为 `@sunbay/checkout-sdk-protocol`。
- `package.json` 加 `dependencies: { "@sunbay/checkout-sdk-protocol": "^0.0.1" }`。
- 验证：type-check ✅、build ✅、test 74/74 ✅。

**checkout（本仓库之外，已改为依赖 protocol 包，验证通过）**
- 删除 `src/sdk-runtime/protocol/` 本地副本。
- 18 个文件引用（`@/sdk-runtime/protocol` 和 2 处 `./protocol`）改为 `@sunbay/checkout-sdk-protocol`。
- `package.json` 加 `dependencies: "@sunbay/checkout-sdk-protocol": "^0.0.1"`；lock 指向 registry。
- 验证：`npm run lint`（eslint + tsc）✅、sdk-runtime 测试 105/105 ✅。
- 注意：该仓库 `npm install` 的 `prepare` 脚本会跑 `husky`，当前环境缺 husky 会 127；用 `--ignore-scripts` 可绕过（仅本地验证时）。
- `AGENTS.md` 已新增/精简「第 11 节 External SDK」。

**workspace（npm 版，已可跑但非最终形态）**
- 新建 workspace 根 `package.json`（`@sunbay/checkout-sdk-web`，private，`workspaces: [protocol, js]`）。
- 删除 `js`、`protocol` 各自的 `package-lock.json`，统一用根 lock。
- ⚠️ 尝试 `workspace:*` 失败：**npm 11 不支持 `workspace:` 协议**（`EUNSUPPORTEDPROTOCOL`），已回退为 `^0.0.1`。npm 原生 workspace 已把 `node_modules/@sunbay/checkout-sdk-protocol` symlink 到 `protocol`，本地链路验证通过。
- 注：此为 npm 阶段的历史记录；现已迁 pnpm（见下），`workspace:*` 已可用。

---

## 2. 待办（主线：迁移到 pnpm）

### 任务 A：安装并启用 pnpm
- `corepack enable && corepack prepare pnpm@latest --activate`（或 `npm i -g pnpm`）。
- 版本建议 pnpm 9+。

### 任务 B：把仓库根改成 pnpm workspace
1. 新建仓库根 `pnpm-workspace.yaml`：
   ```yaml
   packages:
     - protocol
     - js
     # - react   # 成包后再加
   ```
2. 根 `web/package.json`：可**移除** `workspaces` 字段（pnpm 用 yaml 定义成员），保留 `private: true` 和聚合脚本；聚合脚本改用 pnpm 过滤器：
   ```jsonc
   {
     "scripts": {
       "build": "pnpm -r --filter ./protocol --filter ./js run build",
       "type-check": "pnpm -r run type-check",
       "test": "pnpm -r run test"
     }
   }
   ```
3. `js/package.json` 依赖改回 **`"@sunbay/checkout-sdk-protocol": "workspace:*"`**（pnpm 支持，publish 时自动替换为真实版本）。
4. 删除 npm 的根 `package-lock.json`，改用 pnpm：根目录 `pnpm install` 生成 `pnpm-lock.yaml`。
5. 验证 `node_modules/@sunbay/checkout-sdk-protocol` 指向本地 `protocol`（pnpm 会用 symlink 到 `.pnpm`）。

### 任务 C：验证 workspace 本地链路
在仓库根：
- `pnpm --filter @sunbay/checkout-sdk-protocol run build`
- `pnpm --filter @sunbay/checkout-sdk-js run type-check && pnpm --filter @sunbay/checkout-sdk-js run test && pnpm --filter @sunbay/checkout-sdk-js run build`
- 期望：protocol build ✅、js type-check ✅、test 74/74 ✅、build ✅。
- 联调验证：改 protocol 的 `src`，重新 build protocol，确认 js 立刻拿到最新（无需发 npm）。

### 任务 D：清理失效的 sync 机制（本次会话未做，留给你）
- 删除 `protocol/scripts/sync-protocol.mjs`（副本已全部移除，脚本已无目标意义）。
- 删除 `protocol/package.json` 里 `scripts.sync` 和 `scripts.sync:check`。
- 确认全仓无处再引用该脚本（CI / git hook）。
- 注：本会话已把 js 从脚本 TARGETS 移除并更新注释；checkout 副本也已删。脚本目前仅剩一个指向 checkout 的 TARGET，但该副本已不存在，故整脚本可删。

### 任务 E：AGENTS.md 文档（已完成）
按用户要求新增（路径为新布局）：
- `AGENTS.md`（总）：Web（protocol/js/react）分布、协议真源、workspace(pnpm) 开发流程、发版 + semver + PROTOCOL_MAJOR 约定、发布令牌 `SUNBAY_NPM_TOKEN` 注意事项、Native 由独立仓库维护的说明。
- `protocol/AGENTS.md`：协议真源、导出入口、semver 契约纪律、构建(tsup)。
- `js/AGENTS.md`：createCheckout 入口、依赖 protocol(workspace)、transport/iframe、构建产物(esm/cjs/iife)、测试。
- `react/AGENTS.md`：占位。
- 原则：react 现为空目录（仅 .gitkeep），只写「规划中/占位」，不编造内容。
- 注：原 `native/AGENTS.md` 随 `native/` 目录一并移出本仓库（Native SDK 独立仓库维护）。

### 任务 F：发布 `@sunbay/checkout-sdk-js@0.0.1`（本次会话未做，暂不发布）
前置：protocol 已发布（已完成）、js build 产物正常（已验证）。
- pnpm 下：`cd js && pnpm build && pnpm publish --access public --no-git-checks`
  - pnpm 会把 `workspace:*` 自动替换为真实版本号写入发布 tarball。
- 发布令牌：环境变量 `SUNBAY_NPM_TOKEN`（granular token，权限 **Read and write (publish and stage)** + **Bypass 2FA**；**切勿打印/提交 token 值**）。
- 令牌写法（临时 npmrc，勿落盘到仓库）：`//registry.npmjs.org/:_authToken=${SUNBAY_NPM_TOKEN}`。
- 发布后 `npm view @sunbay/checkout-sdk-js version` 确认（registry 同步有几分钟延迟属正常）。

### 任务 G：git 提交（两个仓库，本次会话未提交）
- `checkout-sdk-web`（当前在 `main`）：按团队规范**不要直接在 main 开发**，另开 `feature/sdk-workspace` 或 `chore/protocol-npm` 分支提交。
- `checkout`（当前在 `feature/checkout-sdk-hosted-runtime`，mainline 由 `$SUNBAY_RELEASE_BRANCH_CHECKOUT`=release/v1.0.7 指定）：按 AGENTS.md 规范，`git add` 精确到文件，不用 `git add .`；不要提交 `.env*`/凭证；默认推工作分支，不直推 mainline。
- 提交前对两仓分别跑一遍验证（见任务 C / checkout 的 lint+test）。

---

## 3. 发布流程会怎么变（给用户的说明）

- **开发期**：pnpm workspace 后，`js` 用 `workspace:*` 永远指向本地 protocol；改协议 → build protocol → js 立即生效，**不用发 npm、不用 npm link**。
- **发布期**：`pnpm publish` 对每个包发布；`workspace:*` 自动替换为真实版本号。可用 `pnpm -r publish` 批量。
- **跨仓的 checkout**：永远走已发布 npm 包 `^0.0.x`，SDK 仓用 npm 还是 pnpm 对它无影响。
- **2027 起**：npm 废弃「token 直接 publish」，届时迁 **Trusted Publishing（GitHub Actions + OIDC）**，这才是发布方式的根本变化（无长期 token、带 provenance）。建议后续给 checkout-sdk-web 配一个 release workflow。

---

## 4. 验证标准（Definition of Done）

- 仓库根 `pnpm install` 成功，protocol 本地 symlink 生效。
- protocol：build ✅。
- js：type-check ✅ / test 74 passed ✅ / build ✅（esm+cjs+iife+dts）。
- checkout：`npm run lint` ✅ / sdk-runtime 测试 105 passed ✅；`node_modules/@sunbay/checkout-sdk-protocol` 为 registry 实体（非 symlink）。
- sync 脚本及 protocol 的 sync 相关 npm script 已删除，无残留引用。
- 四个 AGENTS.md（+可选 react）已创建，native 为占位。
- （发布 js 时）`npm view @sunbay/checkout-sdk-js version` == 0.0.1。

---

## 5. 回滚 / 风险

- **workspace 切换失败**：删除 `pnpm-workspace.yaml` / `pnpm-lock.yaml`，`js` 依赖改回 `^0.0.1`，回到 npm workspace（当前已验证可用状态）。
- **checkout Turbopack 解析问题**：本会话已验证「依赖 registry npm 包」模式下 lint+test 通过；若未来改用本地 link 联调 checkout，需重测 Turbopack 对 symlink 的解析（这正是当初用源码副本的原因）。checkout 消费方**保持用 registry 包**最安全。
- **协议不兼容**：破坏性改动必须升 protocol major，并在运行时握手 `PROTOCOL_MAJOR` 校验处拒绝；不能只靠 npm 版本号。
- **token 泄露**：`SUNBAY_NPM_TOKEN` 为 bypass-2fa 令牌，泄露可发布你的包；勿写入仓库/日志，发布后可在 npmjs.com 轮换。

---

## 6. 关键路径速查

| 内容 | 路径 |
|---|---|
| 协议真源 | `protocol/src/` |
| JS SDK 源 | `js/src/`（入口 `index.ts` → `createCheckout`） |
| workspace 根 | 仓库根 `package.json` + `pnpm-workspace.yaml` |
| 失效 sync 脚本（已删） | ~~`protocol/scripts/sync-protocol.mjs`~~（已删除） |
| 消费方（跨仓，走 npm 包） | `checkout/src/sdk-runtime/`，`checkout/package.json` |
| 发布令牌 | 环境变量 `SUNBAY_NPM_TOKEN`（勿打印） |
