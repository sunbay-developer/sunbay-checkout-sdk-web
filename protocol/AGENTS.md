# AGENTS.md — protocol（@sunbay/checkout-sdk-protocol）

SDK ↔ hosted runtime 通信协议契约的**单一真源**。动手前请先读仓库根 `checkout-sdk-web/AGENTS.md`。

---

## 1. 职责与边界

- 定义 SDK（`js`）与 hosted runtime（`checkout/src/sdk-runtime`）之间的信封、命令、事件、错误码与公共类型。
- **零反向依赖**：protocol 不得依赖 `js` 或 runtime。依赖方向单向。
- 真源目录 `src/`；两类消费方分别通过 workspace（js）与已发布 npm 包（checkout）消费，**不存在源码副本**。

---

## 2. 导出入口（`src/index.ts`）

统一出口聚合以下模块，使用者只从包根 `@sunbay/checkout-sdk-protocol` 导入：

- `envelope.ts` — `PROTOCOL_NAME`（`'sunbay-checkout'`）、`PROTOCOL_MAJOR`（当前 `1`）、`encodeEnvelope` / `decodeEnvelope`、`EnvelopeDecodeError`、`Envelope`、`RuntimeHello`。
- `errors.ts` — `ErrorCode` 及 `ErrorCodeValue`。
- `commands.ts` — `COMMAND_NAMES` / `isCommandName` 及各命令 Req/Resp 类型（initialize、createElement、updateElement、destroyElement、elementAction、updateCheckout、getSession、getPaymentStatus、confirm、destroy）。
- `events.ts` — `EVENT_NAMES` / `isEventName` 及各事件 payload 类型（ready、elementReady、change、focus、blur、loadError、availablePaymentMethodsChange、expressAvailabilityChange、paymentStateChange、paymentResult、error）。
- `types.ts` — 公共领域类型（TxnStatus、AddressInfo、PaymentMethod、PublicSessionView、PaymentOutcome、CheckoutError、Appearance、各 Element options 等）。

> 协议名 `sunbay-checkout`、`major=1` 与 Native Bridge 的 `{v:1,...}` 是**不同协议**，数字相同不代表兼容。

---

## 3. semver 契约纪律

- **破坏性变更**（删除/重命名信封字段、命令、事件、错误码，或改变其语义/必填性）→ **升 npm major**，并**同步提升 `PROTOCOL_MAJOR`**；运行时握手会拒绝不兼容的对端。
- 向后兼容的新增（新命令/事件/可选字段）→ minor。
- 修订/注释/构建 → patch。
- **运行时兼容性以握手 `PROTOCOL_MAJOR` 为准**，npm 版本号仅用于依赖管理。
- `decodeEnvelope` 做最小运行时结构校验（protocol/major/kind/必填字段）；`RuntimeHello`（`kind:'hello'`）握手期尚无 checkoutId，由传输层单独识别，不走 `decodeEnvelope`。

---

## 4. 构建（tsup）

```bash
pnpm --filter @sunbay/checkout-sdk-protocol run build        # tsup：esm(.mjs)+cjs(.cjs)+dts
pnpm --filter @sunbay/checkout-sdk-protocol run type-check   # tsc --noEmit
```

- `tsup.config.ts`：entry `src/index.ts`，format `['esm','cjs']`，`dts: true`，`sourcemap: true`，`clean: true`。
- 产物在 `dist/`：`index.mjs` / `index.cjs` / `index.d.ts`(+`.d.cts`)。`package.json` 的 `exports` / `main` / `module` / `types` 指向这些产物；`files` 仅发布 `dist`。
- `js` 的 type-check/build 依赖本包 `dist`，因此**改协议后必须先 build 本包**，js 才能拿到最新类型与产物（workspace 下即时生效）。

---

## 5. 注意事项

- 改协议时，若 `checkout` 仓库的 hosted runtime 有对应文档（如 bridge/payload 规格），代码与文档须同步。
- 不要重新引入已废弃的 `sync-protocol.mjs` 源码副本机制。
