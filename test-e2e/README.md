# Checkout Web SDK —— 真机测试用例规格（test-e2e）

> 本目录是对外 Web SDK（`@sunbay/checkout-sdk-js`）的**真机（real-device）测试用例规格**。
> 它描述「在真实环境里，如何验证对外发布的 SDK 功能都能正常使用」，并作为后续
> **生成一系列可执行真机测试代码**（每个用例一个）的蓝图 —— 之后 AI 可自动执行这些
> 用例、读取结果、据此决定下一步动作。
>
> 本规格**不是单元测试**。单元/集成测试已由 `js/test/*`（Vitest + jsdom）与 checkout
> 仓 `src/sdk-runtime/*` 覆盖。真机测试跑**真实浏览器 + 真实跨源 iframe + 真实建单**，
> 补齐 jsdom 覆盖不到的跨源 postMessage、origin 校验、主题跨 iframe 生效、真实支付链路。

---

## 1. 目的与范围

被测对象是**对外发布的 SDK 公共契约**（见 `js/src/index.ts` 导出）：

- 入口：`createCheckout(options)` → `CheckoutInstance`，IIFE 产物挂 `window.SunbayCheckout`。
- `CheckoutInstance`：`create` / `confirm` / `getSession` / `refresh` / `getPaymentStatus`
  / `updateCheckout` / `on` / `off` / `destroy`。
- `CheckoutElement`：`mount` / `unmount` / `destroy` / `update` / `on` / `off` /
  `focus` / `blur` / `clear`（仅输入类）/ `getAvailableWallets`（仅 express）。
- Element 类型（嵌入模式）：`card` / `cardNumber` / `cardExpiry` / `cardCvc` /
  `address` / `expressCheckout`。
- 主题定制：`appearance.colorScheme`（light/dark/auto）、`appearance.variables`
  （7 个白名单设计变量）、`appearance.rules`（7 个语义 target）；初始（iframe src
  首帧无闪）与运行时（`updateCheckout`）两条路径。
- 钱包按钮定制：`expressCheckout` 的 per-wallet `buttonTheme` / `buttonType` 与全局
  `buttonHeight`、钱包开关。
- 事件：`ready` / `change` / `focus` / `blur` / `loadError` / `elementReady` /
  `expressAvailabilityChange` / `paymentStateChange` / `paymentResult` / `error`。
- 贯穿安全不变式（PCI）：**卡数据绝不经由 SDK / 父窗口 / postMessage 通道**；卡值只在
  hosted iframe 内本地 RSA 加密后直连后端。

**不在本规格范围内**（由已有单测保证）：钱包 `buttonType` / `buttonTheme` 的官方全集
逐值映射（`parseExpressOptions` / `resolveWalletButtonTheme`）、纯逻辑工具函数、
appearance 白名单校验器的穷举分支。真机只验「配置是否正确透传并在真实 iframe 生效」。

---

## 2. 三层架构（真实环境模拟）

真机测试沿用「三角色、三 origin」的真实跨源模型（与被删除的 `js/examples/` 同构，但
测试基础设施独立于 `examples/`，常驻于本 `test-e2e/` 目录）：

```
测试宿主页 (test harness)        测试后端 (test-e2e server)        Sunbay 平台 + hosted runtime
  标准商户页模拟器                 持沙箱商户密钥建单                 建单 API / /sdk/main
  独立 origin（默认 :8090）         /api/create-session              /sdk/field/* /sdk/element/*
        │                              │  （密钥只在服务端）             （hosted runtime，默认 :3000）
        │ ① POST /api/create-session   │                                      │
        │─────────────────────────────▶│                                      │
        │                              │ ② 用沙箱密钥建单 ──────────────────────▶│
        │ ③ { sessionId } ◀─────────────│◀──────────── { sessionId } ───────────│
        │                                                                      │
        │ ④ window.__sunbayHarness.setup(用例配置)                              │
        │      → createCheckout({ sessionId, hostOrigin })                     │
        │      → 隐藏 main iframe + 可见 field/element iframe（全部 hosted 托管）│
        │ ⑤ 浏览器自动化驱动 + 读取 events / parentMessages / DOM 断言           │
        ▼
   （卡值仅存在于 hosted iframe 内，父窗口/SDK 全程不触碰）
```

三个 origin 必须**互不同源**，才能真实覆盖跨源 postMessage、`event.origin` 校验、
跨 iframe 信令频道：

- 测试宿主页 + 测试后端：同一 origin（默认 `http://localhost:8090`）。
- hosted runtime：另一 origin（默认 `http://localhost:3000`，即 checkout 仓 `npm run dev`；
  或指向真实已部署的 hosted 环境）。

> 为什么不在 checkout 仓内验证：hosted 页与真实商户页**不同源**，只有独立 origin 的宿主页
> 才能真实覆盖 SDK 的跨源行为。这也是测试宿主页必须独立存在的原因。

---

## 3. 运行前置

1. **hosted runtime 可达**：提供 `/sdk/main`、`/sdk/field/<type>`、`/sdk/element/<type>`。
   本地可用 checkout 仓 `npm run dev`（:3000）；也可指向真实部署环境。
   > 长驻进程（dev server）由人工启动，测试执行器不在后台启动它。
2. **SDK IIFE 产物已构建**：`js/dist/index.global.js`（`pnpm --filter @sunbay/checkout-sdk-js run build`）。
   测试宿主页通过 `<script>` 加载**真实对外产物**（而非源码），保证测的是发布形态。
3. **测试后端可建沙箱单**：`test-e2e/server`（沿用 examples 的 `server.mjs` 模式）持
   **沙箱商户密钥**，暴露 `POST /api/create-session` 返回 `sessionId`。密钥只在服务端，
   从 `.env.local`（git-ignore）读取，浏览器永不接触。
4. **沙箱测试卡**：功能测试用，见 `fixtures/test-cards.ts`（公开测试数据，明文）。

---

## 4. 执行约定（供 AI 自动执行）

每个用例是一个**结构化条目**（模板见 `test-cases.md` §1），字段可直接映射为一次浏览器
自动化执行：

- `harness-config` → 调 `window.__sunbayHarness.setup(config)` 声明式构造场景。
- `steps` → 有序的浏览器动作（导航 / 填值 / 点击 / 调钩子方法）。
- `expected` / `assertions` → 通过 `evaluate_script` 读取 `__sunbayHarness.events`、
  `__sunbayHarness.parentMessages`、`instance` / `elements` 状态与 DOM/计算样式判定 pass/fail。
- `cleanup` → 调 `destroy()` / `reset()` 复位，保证用例间无状态残留。

**卡值输入**（涉及支付链路的用例）**不经钩子**：由浏览器自动化**直接向 hosted 的
`cardNumber` / `cardExpiry` / `cardCvc` iframe 内输入**（跨 iframe 操作），harness 只提供
容器定位。断言反向校验「父窗口 `parentMessages` / `events` 不含该卡号」。

---

## 5. 优先级与可选标记体系

每个用例带以下标记，供执行器分层编排与自动跳过：

**优先级（priority）**

| 级别 | 含义 | 建议编排 |
|---|---|---|
| P0 | 核心对外能力，发布必过 | 每次回归必跑 |
| P1 | 重要能力/常见组合 | 每次回归必跑 |
| P2 | 边界/增强/较少用 | 完整回归跑，快速回归可略 |

**真机条件（real-device-condition）** —— 标记用例对特殊环境的依赖；不满足时**按预期跳过，
不记为失败**：

| 标记 | 含义 | 不满足时的预期 |
|---|---|---|
| `none` | 普通浏览器即可 | —— |
| `requires-apple-pay` | Safari + Apple 设备 + 后端 Apple 证书/域名验证 | 按钮不渲染、`availableWallets.applePay=false` 属预期 |
| `requires-google-pay` | HTTPS 测试域 + Google 测试商户配置 | 按钮不渲染、`availableWallets.googlePay=false` 属预期 |
| `requires-blackhole` | 需一个不回 hello 的不可达 hostOrigin（如 `http://127.0.0.1:59999`） | —— |
| `requires-stub-runtime` | 需 `test-e2e/` 提供的伪 hello 端点（回不含当前 PROTOCOL_MAJOR 的 RuntimeHello） | 无桩时该用例不在真机范围，由已有单测保证 |
| `requires-session-variant` | 需能建出特定标记的 session（如 `collectShippingAddress:true`） | 沙箱无法控制时降级为「仅断言 session 视图字段透传」 |
| `requires-payment-flow` | 需 hosted runtime 真实支付链路（沙箱扣款） | —— |

**可选集（optional）**：错误路径（`PROTOCOL_UNSUPPORTED` / `RUNTIME_LOAD_FAILED`）与
钱包实际拉起用例归入可选集，日常自动回归可按标记跳过，单独编排验证。

---

## 6. 目录内容

| 文件 | 说明 |
|---|---|
| `README.md` | 本文件：目的、三层架构、前置、执行约定、标记体系 |
| `harness-design.md` | 测试宿主页 + `window.__sunbayHarness` 钩子契约、事件/postMessage 记录器、跨 iframe 填卡约定、桩/后端约定 |
| `test-cases.md` | 46 条结构化用例（C1–C7）+ 统一模板 + 贯穿 PCI 断言 |
| `fixtures/test-cards.ts` | 沙箱测试卡常量（功能测试用，公开数据） |

> 后续会在本目录新增可执行测试代码（每用例一个）与测试宿主页/测试后端实现。本规格先定
> 契约与用例，不含实现代码。
