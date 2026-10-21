# 运行指南（RUNNING.md）

> 如何起环境、跑真机 e2e、看结果，以及 AI 调度闭环说明。
> 规格见 `README.md` / `harness-design.md` / `test-cases.md`。

---

## 1. 一次性准备

```bash
# 在 SDK 仓库根（checkout-sdk-web/）安装 workspace 依赖（含 test-e2e）
pnpm install

# 构建 SDK IIFE 产物（harness 页通过 <script> 加载 js/dist/index.global.js）
pnpm --filter @sunbay/checkout-sdk-js run build

# 安装 Playwright 浏览器（Chromium）
pnpm --filter @sunbay/checkout-sdk-e2e run install:browsers
```

配置沙箱商户密钥（真实建单所需；缺失时 session 依赖用例自动跳过）：

```bash
cd test-e2e
cp .env.example .env.local
# 编辑 .env.local：填入沙箱 API_KEY / APP_ID / MERCHANT_ID
```

> `.env.local` 已在 `.gitignore`，不会提交。密钥只在测试后端服务端使用，绝不下发浏览器。

---

## 2. 起依赖服务

真机 e2e 需要两个 origin：

| 服务 | 默认地址 | 谁来起 |
|---|---|---|
| hosted runtime（checkout 仓） | `http://localhost:3000` | 手动：checkout 仓 `npm run dev` |
| 测试后端 + harness 宿主页 | `http://localhost:8090` | **Playwright 自动起**（`webServer`），也可手动 `pnpm --filter @sunbay/checkout-sdk-e2e run server` |

检查 hosted 是否在跑：

```bash
curl -s http://localhost:3000/healthz   # 期望 200
```

> 若 hosted 未起，session/挂载类用例会失败（不是跳过）。错误路径用例（C1-04）用不可达端口，不依赖 hosted。
> 端口 8090 可被占用；如需改，设 `E2E_HARNESS_ORIGIN` 与后端 `PORT`（见 `.env.example`）。

可选桩（仅 C1-03 PROTOCOL_UNSUPPORTED 需要）：

```bash
pnpm --filter @sunbay/checkout-sdk-e2e run stub   # http://localhost:8099
```

---

## 3. 跑测试

```bash
cd test-e2e

# 全部 46 条
pnpm test

# 分级（按标签过滤）
pnpm test:p0            # 仅 P0（冒烟/发布必过）
pnpm test:p1            # 仅 P1
pnpm exec playwright test --grep @p2
pnpm exec playwright test --grep @c4         # 仅某类（C1..C7）
pnpm exec playwright test --grep-invert @optional   # 排除可选集（错误路径/钱包拉起）

# 单用例（按标题关键字）
pnpm exec playwright test --grep "C2-02"

# 单文件
pnpm exec playwright test tests/c4-theming.spec.ts

# 调试
pnpm test:headed       # 带浏览器界面
pnpm test:ui           # Playwright UI 模式
```

跳过逻辑（自动）：
- 无沙箱密钥 → 所有 session 依赖用例 **skip**（C1-02 等 credential-free 用例仍跑）。
- 无 stub runtime → C1-03 **skip**。
- 无 Apple/Google Pay 能力环境 → C6-05 **skip**（钱包不可用属预期）。

---

## 4. 看结果

- **终端**：`list` reporter 实时打印每条 pass/skip/fail。
- **HTML 报告**：`pnpm --filter @sunbay/checkout-sdk-e2e run report`（打开 `playwright-report/`）。失败附 trace / 截图 / 录像。
- **机读 JSON**：`playwright-report/results.json`（供 AI 解析每条用例结果、定位失败）。

---

## 5. AI 调度闭环

这套体系设计为可被 AI 自动调度的回归闭环：

1. **跑**：AI 执行 `pnpm test`（或分级 `--grep @p0`），读 `playwright-report/results.json`。
2. **判读**：按用例 id（C1-01…C7-10）定位 pass/fail/skip；失败项读 trace/截图/错误断言。
3. **归因**：
   - 断言失败 → SDK/hosted 行为与规格不符 → 定位到 `test-cases.md` 对应用例的 expected/assertions。
   - skip → 环境条件未满足（密钥/桩/钱包），非缺陷。
4. **修复**：改 SDK（`js/src`）或 hosted（checkout 仓 `src/sdk-runtime`），重建产物。
5. **重测**：重跑该用例（`--grep "C4-03"`）→ 绿 → 扩跑同类 → 全量回归。

**新增 SDK 功能时**：
1. 在 `test-cases.md` 增加结构化用例（沿用模板 + 标记）。
2. 在对应 `tests/c*-*.spec.ts` 增加一个 `test(... @pX @cN ...)`，必要时在 `harness.mjs` / `support/harness.ts` 加钩子/帮助。
3. 跑新用例 → 绿 → 纳入回归。

这样 feature → case → 真机测试 → AI 发现缺陷 → 修复 → 重测形成闭环。

---

## 6. 目录结构

```
test-e2e/
├── README.md               规格总览、三层架构、标记体系
├── harness-design.md       harness 钩子契约、断言取数、跨源约定
├── test-cases.md           46 条结构化用例（蓝图）
├── RUNNING.md              本文件
├── package.json            @sunbay/checkout-sdk-e2e（workspace 包，不发布）
├── playwright.config.ts    自动起测试后端、reporter、超时
├── tsconfig.json
├── .env.example            密钥模板（复制为 .env.local）
├── server/
│   ├── server.mjs          测试后端：建单 + 静态服务 harness/dist + /healthz
│   └── stub-runtime.mjs     可选伪 hello 端点（PROTOCOL_UNSUPPORTED）
├── harness/
│   ├── harness.html        宿主页（slot 容器 + 加载 SDK IIFE）
│   └── harness.mjs          window.__sunbayHarness 钩子实现
├── fixtures/
│   └── test-cards.ts        沙箱测试卡
├── support/
│   ├── env.ts              origin 解析 + 健康探测 + 跳过条件
│   └── harness.ts          Playwright 侧驱动封装 + PCI 扫描 + 填卡助手
└── tests/
    ├── c1-handshake.spec.ts        C1 (5)
    ├── c2-embedding.spec.ts        C2 (6)
    ├── c3-combination.spec.ts      C3 (9)
    ├── c4-theming.spec.ts          C4 (6)
    ├── c5-element-customization.spec.ts  C5 (5)
    ├── c6-wallet-buttons.spec.ts   C6 (5)
    └── c7-payment-lifecycle.spec.ts C7 (10)
```
