# Checkout SDK — 端到端商户接入 Demo

本目录是一个**完整的商户接入样板**，演示真实商户如何用 Checkout JS SDK 在**自己的
站点**（独立 origin）内嵌入支付：

- `server.mjs` —— 模拟商户后端（Node 18+，零依赖）：托管前端页面，并提供
  `POST /api/create-session`，由**服务端持商户密钥**向 Sunbay 开放平台下单、返回
  `sessionId`（密钥绝不下发浏览器，也规避浏览器跨域调开放平台的 CORS 限制）。
- `merchant-demo.html` —— 模拟商户前端：`<script>` 引入 SDK 产物，调
  `createCheckout`，挂载**拆分卡字段**（cardNumber / cardExpiry / cardCvc）与
  **expressCheckout**（Apple / Google Pay），并发起 `confirm`。

> 为什么不放在 checkout 项目里验证：checkout 托管页与真实商户页**不同源**。只有在
> 独立 origin 的样板里（本 demo server 默认 `:8080`，checkout 为 `:3000`）才能真实
> 覆盖 SDK 的跨域 postMessage / origin 校验 / 跨 iframe 通道。

## 架构（三个角色，三个 origin）

```
商户前端 (merchant-demo.html)        商户后端 (server.mjs)         Sunbay 平台
  http://localhost:8080                http://localhost:8080        open.sunbay-dev.com
        │                                     │                           │
        │  ① POST /api/create-session         │                           │
        │────────────────────────────────────▶│                           │
        │                                     │  ② 持密钥下单 create-session │
        │                                     │──────────────────────────▶│
        │  ③ { sessionId }                     │◀────── { sessionId } ──────│
        │◀────────────────────────────────────│                           │
        │                                                                  
        │  ④ createCheckout({ sessionId, hostOrigin: http://localhost:3000 })
        │       ├── 隐藏 main iframe + 卡字段 / express iframe（均托管于 checkout :3000）
        │       └── confirm / 钱包按钮 → 支付
        ▼
   checkout 托管运行时 (http://localhost:3000)
```

## 前置

- Node **18+**（`server.mjs` 用内置 `fetch`）。
- checkout 托管页在本地运行（提供 `/sdk/main`、`/sdk/field/<type>`、`/sdk/element/<type>`）。
- SDK IIFE 产物 `../dist/index.global.js` 已构建。

## 跑 Demo（三步）

### 1. 起 checkout 托管页（:3000）

```bash
cd /Users/sm4267/workspace/web/checkout
npm run dev            # http://localhost:3000
```

### 2. 构建 SDK 产物

```bash
cd /Users/sm4267/workspace/web/checkout-sdk-web/js
npm install
npm run build          # 生成 dist/index.global.js
```

### 3. 起 demo server 并打开页面（:8080）

```bash
cd /Users/sm4267/workspace/web/checkout-sdk-web/js/examples
node server.mjs        # http://localhost:8080
```

浏览器打开 **http://localhost:8080/merchant-demo.html**。

> demo server 端口与商户/平台参数均可用环境变量覆盖：
> `PORT`、`OPEN_API_URL`、`API_KEY`、`APP_ID`、`MERCHANT_ID`、`CURRENCY`。
> 默认指向 dev 环境（`https://open.sunbay-dev.com`）。

## 操作步骤

1. 点「① 创建订单并初始化」：
   - 前端调商户后端 `/api/create-session` → 服务端下单 → 返回 `sessionId`；
   - 用 `sessionId` 调 `createCheckout`（`hostOrigin` 指向 checkout `:3000`）；
   - 挂载 expressCheckout 与三个拆分卡字段。
2. 卡支付：在卡字段内输入卡号 / 有效期 / 安全码 → 点「② 支付 (confirm)」。
3. 快捷支付：直接点 Apple / Google Pay 按钮（见下方「真机依赖」）。
4. 结果区展示 `paymentResult` 事件与 `confirm` 返回的 `PaymentOutcome`。

## 验收要点

- **完整接入闭环**：下单 → 初始化 → 挂载（卡字段 + express）→ 支付 → 收到结果。
- **卡数据隔离**：卡数据只存在于 checkout 托管 iframe 内；父窗口（本页）监听到的
  事件绝不含任何卡值（明文或密文）。可用 DevTools 核对父窗口收到的 postMessage。
- **密钥不出服务端**：商户 API Key 只在 `server.mjs` 使用，浏览器永远拿不到。

## 真机依赖（Apple / Google Pay）

expressCheckout 按钮的可用性遵循「只减不增」：会话允许的钱包 ∩ 浏览器环境可用 −
商户 `never`。真实唤起钱包面板需：

- **Google Pay**：HTTPS 测试域名 + Google 测试商户配置（经会话 `ewalletParam` 下发）。
- **Apple Pay**：Safari + 配卡的 Apple 设备 + 后端 Apple 能力（Merchant ID、Merchant
  Identity Certificate、域名验证文件、merchant validation 接口）。

在无上述环境的普通浏览器里，express 可用钱包集可能为空（按钮不渲染），属预期；卡字段
支付路径不受影响。
