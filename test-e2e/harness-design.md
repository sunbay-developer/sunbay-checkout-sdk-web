# 测试宿主页 + Harness 钩子契约（harness-design.md）

> 本文件定义真机测试的**执行载体**：一个测试专用的「标准商户页模拟器」（test harness）
> 及其暴露给测试用例的确定性全局钩子 `window.__sunbayHarness`。用例只写**声明式配置 +
> 断言**，所有 SDK 调用细节由 harness 封装，使 AI 落地可执行测试时歧义最小。
>
> harness 属于**测试基础设施**，不是 SDK 的一部分，不进入发布产物。它加载 SDK 的真实
> IIFE 产物，模拟一个真实商户页。**harness 绝不触碰卡值**（PCI）。

---

## 1. 组成

| 组件 | 角色 | 默认 origin |
|---|---|---|
| `harness.html` + `harness.mjs` | 测试宿主页：加载 SDK IIFE 产物，暴露 `window.__sunbayHarness`，提供挂载槽位容器 | `http://localhost:8090` |
| `server`（沿用 examples `server.mjs` 模式） | 测试后端：持沙箱商户密钥，`POST /api/create-session` 返回 `sessionId` | 同宿主页 origin |
| hosted runtime | 被托管的 `/sdk/main`、`/sdk/field/*`、`/sdk/element/*` | `http://localhost:3000` 或真实环境 |
| stub runtime（可选） | 伪 hello 端点，仅供 `PROTOCOL_UNSUPPORTED` 用例 | `test-e2e/` 内，按需起 |

宿主页提供一组 **id 固定的空容器**（挂载槽位 slot），供用例按 id 定位，例如：

```html
<div id="slot-card"></div>
<div id="slot-num"></div>   <div id="slot-exp"></div>   <div id="slot-cvc"></div>
<div id="slot-bill"></div>  <div id="slot-ship"></div>
<div id="slot-express"></div>
<!-- 额外备用槽位：slot-num1 / slot-num2 / slot-b1 / slot-b2 / slot-e1 / slot-e2 等 -->
```

> slot 容器必须唯一且为空（SDK `mount` 要求容器唯一命中且 `childElementCount===0`）。
> `reset()` 会清空所有 slot。

> **多实例语义**：`instance` 始终指向「最近一次 `setup` 成功创建的实例」，仅作单实例场景
> 的便捷引用。多实例用例（C7-10）**必须**通过 `instances[instanceKey]` 定位各实例，不要依赖
> `instance` 单引用；同理 `destroy(instanceKey)` / `confirm(opts, instanceKey)` /
> `updateCheckout(patch, instanceKey)` 需显式传 key。

---

## 2. 全局钩子契约 `window.__sunbayHarness`

> 类型以 TS 伪代码表达，实际实现用 JS/TS 均可。所有方法均 `async` 返回，错误以结构化
> `CheckoutError` 形态记录，不抛裸异常（除非契约显式声明同步抛）。

```ts
interface SunbayHarness {
    // --- 构造场景（声明式）---
    // Create a checkout instance from a freshly created sandbox session,
    // then create + mount the declared elements. Resolves after createCheckout
    // settles and all auto-mount elements reach ready or loadError.
    setup(config: HarnessConfig): Promise<SetupResult>;

    // --- 实时句柄（断言用；setup 成功后可读）---
    instance: CheckoutInstance | null;              // shortcut to the most recently created instance
    instances: Record<string, CheckoutInstance>;    // named instances (multi-instance cases)
    elements: Record<string, CheckoutElement>;      // keyed by slot selector, e.g. '#slot-card'

    // --- 观测记录器（断言的主要数据源）---
    events: HarnessEvent[];          // ordered instance/element events + createError records
    parentMessages: ParentMessage[]; // every window 'message' the parent window received

    // --- 操作（映射 SDK API；用例 steps 调用）---
    confirm(opts?: ConfirmOptions, instanceKey?: string): Promise<ConfirmRecord>;
    update(slot: string, patch: Partial<ElementOptions>): Promise<void>; // element.update
    updateCheckout(patch: { locale?: string; appearance?: Appearance }, instanceKey?: string): Promise<void>;
    action(slot: string, kind: 'focus' | 'blur' | 'clear'): Promise<void>;
    unmount(slot: string): Promise<void>;
    mount(slot: string): Promise<MountRecord>;       // re-mount a previously created element
    createElement(spec: ElementSpec, instanceKey?: string): Promise<CreateRecord>; // late create (conflict cases)
    destroy(instanceKey?: string): Promise<void>;    // instance.destroy; default = single instance

    // --- 复位 ---
    reset(): void;                   // destroy all instances, clear slots, clear records
}
```

### 2.1 `HarnessConfig`

```ts
interface HarnessConfig {
    // Session source. 'auto' => call test backend POST /api/create-session.
    // A string => use that sessionId directly (pre-created).
    session: 'auto' | string;

    // Optional named instance key for multi-instance cases (default '__default__').
    instanceKey?: string;

    env?: 'dev' | 'prod';
    hostOrigin?: string;             // override hosted origin (e.g. stub/blackhole)
    locale?: string;
    appearance?: Appearance;         // colorScheme / variables / rules (instance-level initial)
    paymentMethods?: PaymentMethodFilter;

    elements: ElementSpec[];
}

interface ElementSpec {
    type: ElementType;               // 'card' | 'cardNumber' | 'cardExpiry' | 'cardCvc' | 'address' | 'expressCheckout'
    slot: string;                    // container selector, e.g. '#slot-card'
    options?: ElementOptions;        // per-element options incl. appearance / express options / address mode
    mount?: boolean;                 // default true; false => create only (no DOM mount)

    // Mutual-exclusion cases: when true, create() is EXPECTED to throw ELEMENT_CONFLICT
    // synchronously. setup() catches it, records a 'createError' event, and continues
    // with the remaining elements instead of aborting.
    expectConflict?: boolean;
}
```

### 2.2 结果与记录结构

```ts
interface SetupResult {
    ok: boolean;                     // createCheckout resolved
    error?: CheckoutError;           // set when createCheckout rejected (handshake/initialize)
    checkoutId?: string;
    // Per-slot creation outcome. For expectConflict slots, creationErrors[slot] holds
    // the captured ELEMENT_CONFLICT; otherwise undefined.
    creationErrors?: Record<string, CheckoutError>;
    // Per-slot mount outcome (ready | loadError | skipped).
    mountStatus?: Record<string, 'ready' | 'loadError' | 'skipped'>;
}

interface HarnessEvent {
    t: number;                       // performance.now() timestamp (ordering)
    source: 'instance' | string;    // 'instance' or the slot selector that owns the element
    name: string;                    // event name OR 'createError' / 'mountError'
    payload: unknown;                // event payload (card-value-free by protocol contract)
}

interface ParentMessage {
    t: number;
    origin: string;                  // event.origin
    sameSourceAsIframe: boolean;     // event.source === some tracked iframe.contentWindow
    data: unknown;                   // raw MessageEvent.data
}

interface ConfirmRecord {
    ok: boolean;
    outcome?: PaymentOutcome;        // on success
    error?: CheckoutError;           // on reject (e.g. CHECKOUT_BUSY / INSTANCE_DESTROYED)
    operationId?: string;            // the operationId the instance generated (for correlation)
}

interface MountRecord { ok: boolean; error?: CheckoutError; }
interface CreateRecord { ok: boolean; error?: CheckoutError; slot: string; }
```

---

## 3. setup() 内部行为（规范）

`setup(config)` 必须按下述顺序执行，保证用例的 `expected` 可被确定性观测：

1. **建单**：`session==='auto'` → `POST /api/create-session` 拿 `sessionId`；否则用传入值。
   建单失败 → `SetupResult.ok=false` 且 `error` 为结构化错误，不继续。
2. **createCheckout**：用 `sessionId` + `env`/`hostOrigin`/`locale`/`appearance`/
   `paymentMethods` 调 `createCheckout`。
   - resolve → 存入 `instances[instanceKey]`（及 `instance` 快捷引用），记录 `checkoutId`。
   - reject（如 `RUNTIME_LOAD_FAILED` / `PROTOCOL_UNSUPPORTED` / initialize 失败）→
     `ok=false`、`error=<CheckoutError>`，返回（不再 create elements）。
3. **订阅实例级事件**：对 `paymentResult` / `paymentStateChange` / `error` 调 `instance.on`，
   回调把 `{source:'instance', name, payload}` 推入 `events`。
4. **逐个 create element**（按 config 顺序）：
   - 普通项：`instance.create(type, options)` → 存入 `elements[slot]`；对该 element 订阅
     `elementReady` / `loadError` / `ready` / `change` / `focus` / `blur` /
     `expressAvailabilityChange`，回调推入 `events`（`source` 置为该 slot）。
   - `expectConflict:true`：用 try/catch 包 `create`；捕获到同步抛的 `ELEMENT_CONFLICT`
     → 推 `{source:slot, name:'createError', payload:error}`，写 `creationErrors[slot]`，
     **继续**下一项；若未抛（契约被破坏）→ 记一条 `mountStatus[slot]` 异常供断言失败。
   - `mount!==false`：`await element.mount(slot)`；ready → `mountStatus[slot]='ready'`；
     loadError → `'loadError'`。`mount===false` → `'skipped'`。
5. 全部处理完 → 返回聚合 `SetupResult`。

> `setup` 对单个 element 的 loadError **不**整体 reject；它把状态记进 `mountStatus`，由用例
> 的 assertions 判定预期与否（有的用例就是要验 loadError 旁支）。

---

## 4. 观测记录器

### 4.1 事件记录器

harness 对**所有订阅到的 SDK 事件**统一追加到 `events` 数组，保留**时间顺序**与**来源**
（`instance` 或 slot）。用例断言通过 `evaluate_script` 取回 `__sunbayHarness.events`，按
`name` / `source` / 顺序判定。

- 事件 payload 按协议契约**不含卡值**；记录器**原样**保存 payload，正是为了让 PCI 断言能
  反向扫描「不含卡号」。
- `on` 注册后协议**不重放历史事件**，故 harness 必须在 `create`/`createCheckout` 后**立即**
  订阅，避免漏采早期 `elementReady`。

### 4.2 parentMessage 嗅探器

harness 在**宿主页顶层 window** 安装一个常驻 `message` 监听器，把**每一条**收到的
`MessageEvent` 记成 `ParentMessage`（含 `origin`、是否来自已追踪 iframe 的 contentWindow、
原始 `data`）。用途：

- 验证 iframe 自适应高度消息（`sunbay:checkout:iframe-resize`）的来源与 elementId。
- **PCI 断言**：序列化全部 `parentMessages` 后扫描，确认**绝不出现卡号/CVV**。

> 该监听器独立于 SDK 内部 Element 的 resize 监听，是测试侧的「旁路嗅探」，只读不干预。

---

## 5. 跨 iframe 填卡约定（PCI 关键）

涉及支付链路/输入态的用例要「填卡」，但**卡值绝不经过 harness 钩子或 SDK**。约定：

1. harness 只负责让 `cardNumber` / `cardExpiry` / `cardCvc` 三个 hosted field iframe 就绪，
   并暴露各自的容器 slot 与 iframe（供自动化定位）。
2. **填值由浏览器自动化直接进入 hosted field iframe 内部的输入框完成**（跨 iframe 定位到
   iframe 内的 `<input>` 后输入），不调用任何 SDK/harness 方法传卡值。
3. 填卡所用沙箱卡见 `fixtures/test-cards.ts`。
4. 每个填卡用例**必须**附带 PCI 断言：对 `parentMessages` + `events` 序列化后扫描，
   确认不含卡号（`4012000098765439`）、不含 CVV 片段、不含任何卡号连续子串。

> 因 hosted 与宿主页跨源，跨 iframe 定位 `<input>` 依赖执行器对同源策略的处理（真机环境下
> 浏览器自动化工具可在各自 frame 上下文内操作）。若某执行环境无法跨源操作 iframe 内部
> 输入，则该用例标记为需要「可控填卡入口」，由执行器按能力决定是否纳入 —— 但**无论如何都不
> 得通过 SDK 通道传卡值**。

---

## 6. 桩与后端约定

### 6.1 测试后端 `POST /api/create-session`

- 请求：可选 body 指定币种/金额等（有安全默认）。
- 行为：服务端用**沙箱商户密钥**（`.env.local` 读取，git-ignore）向开放平台建单。
- 响应：`{ sessionId }`。密钥**绝不**下发浏览器。
- `requires-session-variant` 用例：后端需支持建出带特定标记的单（如
  `collectShippingAddress:true`）。若沙箱商户无法控制该标记，则对应用例降级为「仅断言
  session 视图字段被正确透传」，并在用例标记注明。

### 6.2 stub runtime（仅 `PROTOCOL_UNSUPPORTED`）

- 一个最小的 `/sdk/main` 替身端点，握手时回一个 **不含当前 `PROTOCOL_MAJOR`** 的
  `RuntimeHello`（`supportedMajorVersions` 置为不相交的值）。
- 仅用于 `C1-03`。不碰卡值，不进发布产物。
- 若执行环境不提供该桩，`C1-03` 退出真机范围（由 `createCheckout` 的 Vitest 覆盖保证），
  用例保留但标 `requires-stub-runtime` 且归入可选集。

### 6.3 blackhole origin（`RUNTIME_LOAD_FAILED`）

- 指向一个**不会回 hello** 的不可达 origin（如 `http://127.0.0.1:59999`），用于触发
  `createCheckout` 的 15s 握手超时 → `RUNTIME_LOAD_FAILED`。无需桩实现。

---

## 7. 断言取数速查（给执行器）

| 要验证的东西 | 取数方式 |
|---|---|
| createCheckout 成败/错误码 | `setup()` 返回的 `SetupResult.ok` / `error.code` |
| 某 element 是否就绪 | `elements['#slot'].getStatus()` 或 `events` 中该 slot 的 `elementReady` |
| 互斥冲突 | `SetupResult.creationErrors['#slot'].code === 'ELEMENT_CONFLICT'` 或 `events` 的 `createError` |
| iframe src / 路由 / 定制参数 | 读 slot 内 `iframe.src`（查询串含 `colorScheme=` / `appearance=` / `applePay=` 等）—— **父窗口可直接读**，不受跨源限制 |
| 主题/样式是否生效（iframe 内部） | **跨源约束**：hosted iframe 与宿主页不同源，父窗口 JS **无法**读其 `contentDocument` / 计算样式。须用下列之一：(a) 浏览器自动化**切到该 iframe 的 frame 上下文**内执行脚本读 `getComputedStyle` / `.dark` class；(b) **视觉断言**（对该 iframe 区域截图，比对深浅色/主色/圆角等视觉特征）。规格中凡写「跨 iframe 读计算样式」均指手段 (a)/(b)，非父窗口直接读 |
| iframe 自适应高度 | slot 内 `iframe.style.height` > 0（父窗口可读）；`parentMessages` 含 resize 消息且 elementId 匹配 |
| 事件序列（change/ready/focus/blur/express/payment*） | `__sunbayHarness.events` 过滤 `name`/`source`（父窗口可读） |
| confirm 结果 | `confirm()` 返回的 `ConfirmRecord`（`outcome` / `error.code` / `operationId`） |
| 支付终态 | `events` 中 `paymentResult` 的 `outcome.status` 与 `operationId` 对齐 confirm |
| 钱包可用性 | `elements['#slot-express'].getAvailableWallets()`（父窗口可读） |
| PCI：卡值不泄露 | 序列化 `parentMessages` + `events`，扫描不含卡号/CVV 子串（父窗口侧判定） |
| 销毁后行为 | 销毁后调用返回/抛 `INSTANCE_DESTROYED` |

> **跨源断言总则**：凡"iframe **内部** DOM/样式/文案"的断言，必须经 frame 上下文脚本或视觉
> 比对取证；凡"iframe **外层**属性（src、style.height、是否存在）"与"父窗口观测的
> events/parentMessages"，父窗口 JS 可直接读。执行器据此选择取数手段。
