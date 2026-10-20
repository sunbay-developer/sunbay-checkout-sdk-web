# AGENTS.md — js（@sunbay/checkout-sdk-js）

面向商户的浏览器 JS SDK。动手前请先读仓库根 `checkout-sdk-web/AGENTS.md`。

---

## 1. 职责与入口

- 唯一异步入口 `createCheckout(options)` → 返回 `CheckoutInstance`。
- 公共导出（`src/index.ts`）：`createCheckout`、`CheckoutInstance`、`CheckoutElement` 及其 options 类型，`version`，并**再导出**协议公共类型（`ErrorCode`、`CheckoutError`、`PublicSessionView`、各 Element options 等）供 TS 使用者消费。
- IIFE 产物在浏览器挂载 `window.SunbayCheckout = { createCheckout }`。

### 源码结构（`src/`）
- `createCheckout.ts` — 入口编排：生成 `checkoutId` → 解析 host origin → 建 transport + 隐藏 main iframe → 等 `RuntimeHello`（超时 15s）→ 选共同 `PROTOCOL_MAJOR`（无交集则 `PROTOCOL_UNSUPPORTED`）→ 发 `initialize` → 构造 `CheckoutInstance`。
- `CheckoutInstance.ts` — 实例句柄：createElement/confirm/getSession/getPaymentStatus/destroy 等。
- `Element.ts` — `CheckoutElement` 句柄（card / cardField / address / expressCheckout 等）。
- `transport/MainFrameTransport.ts` — 传输层：创建隐藏 0 尺寸 main iframe（`${hostOrigin}/sdk/main?checkoutId=...`），按 `requestId` 配对 request/response，分发 event 信封；**安全过滤**仅接受 `event.origin === hostOrigin` 且 `checkoutId` 匹配的消息。
- `config/env.ts` — `Env` 与 host origin 解析。

---

## 2. 依赖协议（workspace）

- `dependencies: { "@sunbay/checkout-sdk-protocol": "workspace:*" }` —— 通过 pnpm workspace 指向本地 `../protocol`。
- 所有协议类型/常量从包名 `@sunbay/checkout-sdk-protocol` 导入，**不要**写相对路径指向 protocol 源码，也不要维护本地副本。
- 改协议后先 `build protocol`，js 即时拿到最新（workspace symlink）。发布时 pnpm 自动把 `workspace:*` 替换为真实版本号。

---

## 3. 安全约束（PCI）

- transport 信封与 SDK 各层**绝不搬运卡值**（明文或密文）。createCheckout / Instance / Element / transport 只做握手、编排与协议信封搬运。
- 卡数据只在 hosted runtime 页面内本地 RSA 加密并直连后端，不经由本 SDK 或 iframe 消息通道。

---

## 4. 构建与测试

```bash
pnpm --filter @sunbay/checkout-sdk-js run type-check   # tsc --noEmit
pnpm --filter @sunbay/checkout-sdk-js run test         # vitest run（jsdom，当前 74 passed）
pnpm --filter @sunbay/checkout-sdk-js run build        # tsup：esm+cjs+iife+dts
```

- `tsup.config.ts`：entry `src/index.ts`，format `['esm','cjs','iife']`，`globalName: 'SunbayCheckout'`，`dts: true`，`sourcemap: true`，`clean: true`。
- 产物 `dist/`：`index.mjs`（esm）/ `index.cjs`（cjs）/ `index.global.js`（iife）/ `index.d.ts`(+`.d.cts`)。`files` 仅发布 `dist`。
- 测试：Vitest + jsdom，测试在 `test/`，`*.test.ts`。Service/transport 测试通过 mock 驱动 hello/事件。
- type-check/build 依赖 protocol 已 build 的 `dist`（workspace 内即时可用）。

---

## 5. 注意事项

- 新增公共 API 时，记得在 `src/index.ts` 导出，并在需要时同步再导出协议类型。
- 修改握手 / transport / 协议相关逻辑属于敏感改动：明确说明验证了什么、未验证什么；协议破坏性变更须按 `protocol/AGENTS.md` 升 major。
