# 真机测试用例（test-cases.md）

> 本文件是 Checkout Web SDK 真机测试的**用例清单**：46 条结构化用例，覆盖 C1–C7 七大类。
> 每条用例可直接映射为一个可执行真机测试。读前请先读 `README.md`（三层架构、标记体系）
> 与 `harness-design.md`（`window.__sunbayHarness` 钩子契约、取数速查）。

---

## 1. 用例模板

每条用例统一使用以下字段：

```
### <id> <title>
- category / priority / real-device-condition [/ optional]
- preconditions   前置条件
- harness-config  传给 __sunbayHarness.setup() 的声明式配置
- steps           有序动作（映射浏览器自动化操作）
- expected        可观测点（DOM / events / parentMessages / iframe 状态 / 计算样式）
- assertions      明确的 pass/fail 判据
- cleanup         复位动作（destroy / reset）
```

**贯穿性 PCI 断言（全局不变式，适用于所有填卡用例）**：对 `__sunbayHarness.parentMessages`
与 `__sunbayHarness.events` 序列化后扫描，**绝不得出现**沙箱卡号 `4012000098765439`、
其任意连续子串、或 CVV `999`（作为卡上下文）。任何填卡用例若未显式写出，此断言隐含成立并
必须被执行器附加。

**跨源断言全局约定（适用于 C4 / C5 及一切"iframe 内部样式/文案"断言）**：hosted iframe 与
测试宿主页**不同源**，父窗口 JS **无法**读取 iframe 的 `contentDocument` 或计算样式。凡本文
写「跨 iframe 读计算样式 / `.dark` / 文案」，均指下列取证手段之一（执行器按能力择一）：
(a) 浏览器自动化**切到该 iframe 的 frame 上下文**内执行脚本读 `getComputedStyle` / class / 文本；
(b) **视觉断言**（对该 iframe 区域截图比对）。而 iframe **外层**属性（`iframe.src`、
`style.height`、是否存在）与父窗口观测的 `events`/`parentMessages`，父窗口可直接读，不受此限。
详见 `harness-design.md` §7「跨源断言总则」。

**用例矩阵**：C1(5) + C2(6) + C3(9) + C4(6) + C5(5) + C6(5) + C7(10) = **46 条**。

---

## 2. C1 握手与初始化

### C1-01 createCheckout 握手 + 初始化成功
- **category** C1 · **priority** P0 · **real-device-condition** `none`
- **preconditions** hosted runtime 可达；测试后端可建沙箱 session
- **harness-config** `{ session:'auto', elements:[] }`
- **steps**
  1. 调 `setup({ session:'auto', elements:[] })`
  2. 调 `instance.getSession()`
- **expected**
  - `SetupResult.ok===true`，`instance` 非空，`checkoutId` 存在
  - 存在隐藏 main iframe，src 指向 `<hostOrigin>/sdk/main?checkoutId=...`，尺寸 0×0
  - `getSession()` 返回的 `PublicSessionView` 含 `sessionId/currency/totalAmount/paymentMethods`
- **assertions**
  - `ok===true` 且 `instance.checkoutId` 为非空字符串
  - main iframe 存在且 `offsetWidth===0 && offsetHeight===0`
  - session 对象**不含** `rsaPublicKey` 键
- **cleanup** `destroy()`

### C1-02 IIFE 全局暴露 window.SunbayCheckout
- **category** C1 · **priority** P0 · **real-device-condition** `none`
- **preconditions** 宿主页通过 `<script>` 加载 SDK IIFE 产物 `index.global.js`
- **harness-config** 不建 session，仅检查全局
- **steps** 1. 页面加载后读取 `window.SunbayCheckout`
- **expected** `window.SunbayCheckout.createCheckout` 为 function
- **assertions** `typeof window.SunbayCheckout.createCheckout === 'function'`
- **cleanup** 无

### C1-03 协议大版本不兼容 → PROTOCOL_UNSUPPORTED
- **category** C1 · **priority** P1 · **real-device-condition** `requires-stub-runtime` · **optional**
- **preconditions** stub runtime 可达，握手回不含当前 `PROTOCOL_MAJOR` 的 `RuntimeHello`
- **harness-config** `{ session:'e2e-fake-session', hostOrigin:'<stub-runtime-origin>', elements:[] }`
- **steps** 1. `setup(...)`
- **expected** `SetupResult.ok===false`，`error.code==='PROTOCOL_UNSUPPORTED'`；main iframe 被销毁
- **assertions** `error.code==='PROTOCOL_UNSUPPORTED'`；DOM 无残留 main iframe
- **cleanup** `reset()`
- **note** 握手在 initialize **之前**失败，故**不依赖真实建单**（用固定假 sessionId，credential-independent）。无桩环境时本用例退出真机范围，由 `createCheckout` 的 Vitest 覆盖保证。

### C1-04 runtime 不可达/握手超时 → RUNTIME_LOAD_FAILED
- **category** C1 · **priority** P1 · **real-device-condition** `requires-blackhole` · **optional**
- **preconditions** 指向一个不会回 hello 的不可达 origin
- **harness-config** `{ session:'e2e-fake-session', hostOrigin:'http://127.0.0.1:59999', elements:[] }`
- **steps** 1. `setup(...)`（等待约 15s 握手超时）
- **expected** `setup` 在 ≤16s 内返回 `ok===false`，`error.code==='RUNTIME_LOAD_FAILED'`；main iframe 被销毁
- **assertions** `error.code==='RUNTIME_LOAD_FAILED'`；DOM 无残留 main iframe
- **cleanup** `reset()`
- **note** 握手超时在 initialize **之前**发生，故**不依赖真实建单**（用固定假 sessionId，credential-independent）。

### C1-05 paymentMethods 过滤（只做减法/排序）
- **category** C1 · **priority** P2 · **real-device-condition** `none`
- **preconditions** 建单返回含多种支付方式（至少 card + 一个钱包）
- **harness-config** `{ session:'auto', paymentMethods:{ hide:['applePay'], order:['card','googlePay'] }, elements:[] }`
- **steps** 1. `setup(...)` 2. `getSession()`
- **expected** 返回的 `paymentMethods` 不含被 hide 项；顺序符合 order；前端只减法/排序，不新增
- **assertions** 结果集 ⊆ 原始可用集；无 `applePay`；按 order 排序；无 order 外新增项
- **cleanup** `destroy()`

---

## 3. C2 嵌入模式

### C2-01 合并 card Element 挂载
- **category** C2 · **priority** P0 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{ type:'card', slot:'#slot-card' }] }`
- **steps** 1. `setup(...)`（自动 mount）
- **expected**
  - `#slot-card` 内出现 1 个可见 iframe，src 段 `/sdk/element/card`，查询串含 `checkoutId` 与 `elementId`
  - 收到该 elementId 的 `elementReady`；`getStatus()==='ready'`
  - 收到 resize 消息后 iframe 高度 > 0
- **assertions** slot iframe 存在且 src 含 `/sdk/element/card`；`events` 含对应 `elementReady`；`getStatus()==='ready'`
- **cleanup** `destroy()`

### C2-02 拆分三字段挂载（cardNumber/cardExpiry/cardCvc）
- **category** C2 · **priority** P0 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'cardNumber',slot:'#slot-num'},{type:'cardExpiry',slot:'#slot-exp'},{type:'cardCvc',slot:'#slot-cvc'}] }`
- **steps** 1. `setup(...)`
- **expected** 三 slot 各 1 iframe，src 段分别 `/sdk/field/cardNumber|cardExpiry|cardCvc`；三 `elementReady` 各自 elementId 互不相同、事件不串扰
- **assertions** 三 iframe src 正确；`events` 含 3 条 `elementReady` 且 elementId 与各 slot 一一对应；无串扰（每 slot 恰一条）
- **cleanup** `destroy()`

### C2-03 address Element（billing + shipping 各一）
- **category** C2 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'address',slot:'#slot-bill',options:{mode:'billing'}},{type:'address',slot:'#slot-ship',options:{mode:'shipping'}}] }`
- **steps** 1. `setup(...)`
- **expected** 两 address iframe（src 段 `/sdk/element/address`）分别就绪；`mode` 分别 billing/shipping
- **assertions** 两 `elementReady`；`elements['#slot-bill'].mode==='billing'`、`elements['#slot-ship'].mode==='shipping'`
- **cleanup** `destroy()`

### C2-04 expressCheckout 挂载 + 可用性事件
- **category** C2 · **priority** P1 · **real-device-condition** `none`（钱包实际可用性见 C6-05）
- **harness-config** `{ session:'auto', elements:[{type:'expressCheckout',slot:'#slot-express'}] }`
- **steps** 1. `setup(...)`
- **expected**
  - express iframe（src 段 `/sdk/element/expressCheckout`）就绪
  - `elementReady` 携 `availableWallets`；`getAvailableWallets()` 返回含 `applePay`/`googlePay` 两布尔键的对象
  - 普通浏览器下两者可能全 false（按钮不渲染）—— **属预期，非失败**
- **assertions** 收到 `elementReady`；`getAvailableWallets()` 为含两布尔键对象；若收到 `expressAvailabilityChange` 则快照随之更新
- **cleanup** `destroy()`

### C2-05 iframe 自适应高度
- **category** C2 · **priority** P2 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'card',slot:'#slot-card'}] }`
- **steps** 1. `setup(...)` 2. 等待 resize 消息
- **expected** 父窗口收到来自本 iframe 的 `sunbay:checkout:iframe-resize`（`origin===hostOrigin`、`source===iframe.contentWindow`）；外层 iframe 高度被设为内容高度
- **assertions** `parentMessages` 含该 type 消息且 `elementId` 匹配本 element；slot 内 `iframe.style.height` 为正 px
- **cleanup** `destroy()`

### C2-06 合并 card 子选项（showBillingAddress/showShippingAddress/showPostalCode）
- **category** C2 · **priority** P1 · **real-device-condition** `none`
- **harness-config** 三变体：
  - A `{ options:{ showBillingAddress:true, showShippingAddress:true, showPostalCode:true } }`
  - B `{ options:{ showBillingAddress:false, showShippingAddress:false, showPostalCode:false } }`
  - C `{ options:{ showPostalCode:true } }`（仅邮编）
  - 每变体 `elements:[{type:'card',slot:'#slot-card',options:<上>}]`
- **steps** 1. 分别 `setup(...)`（变体间 `reset()`）
- **expected** 合并卡 iframe 内对应区块随开关出现/隐藏（账单地址、配送地址、邮编）
- **assertions** 跨 iframe 读 hosted 文档：A 三区块可见；B 账单/配送地址区块不可见；C 邮编输入可见而地址区块按配置
- **cleanup** 每变体 `destroy()`
- **note** 子区块的具体 DOM 锚点以 hosted `CardElementApp` 实际渲染为准，断言取「区块存在性」而非像素级样式。

---

## 4. C3 组件组合与互斥

### C3-01 典型组合：拆分三字段 + billing address + expressCheckout
- **category** C3 · **priority** P0 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'cardNumber',slot:'#slot-num'},{type:'cardExpiry',slot:'#slot-exp'},{type:'cardCvc',slot:'#slot-cvc'},{type:'address',slot:'#slot-bill',options:{mode:'billing'}},{type:'expressCheckout',slot:'#slot-express'}] }`
- **steps** 1. `setup(...)`
- **expected** 5 个 element 全部 `ready`，各自 `elementReady` 一一对应，事件不串扰
- **assertions** 5 slot 各 1 iframe，src 段正确；`events` 含 5 条 `elementReady` 与各 slot 对应；全部 `getStatus()==='ready'`
- **cleanup** `destroy()`

### C3-02 典型组合：合并 card + expressCheckout
- **category** C3 · **priority** P0 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'card',slot:'#slot-card'},{type:'expressCheckout',slot:'#slot-express'}] }`
- **steps** 1. `setup(...)`
- **expected** card 与 express 各就绪，互不冲突
- **assertions** 两 `elementReady`；card src 段 `/sdk/element/card`、express src 段 `/sdk/element/expressCheckout`；无 `createError`
- **cleanup** `destroy()`

### C3-03 互斥：合并 card 存在时 create 拆分字段 → ELEMENT_CONFLICT
- **category** C3 · **priority** P0 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'card',slot:'#slot-card'},{type:'cardNumber',slot:'#slot-num',expectConflict:true}] }`
- **steps** 1. `setup(...)`
- **expected** 第二个 `create('cardNumber')` 同步抛 `ELEMENT_CONFLICT`，被 harness 捕获；card 正常就绪
- **assertions** `SetupResult.creationErrors['#slot-num'].code==='ELEMENT_CONFLICT'`；`#slot-num` 内无 iframe；card `ready`
- **cleanup** `destroy()`

### C3-04 互斥：拆分字段存在时 create 合并 card → ELEMENT_CONFLICT
- **category** C3 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'cardNumber',slot:'#slot-num'},{type:'card',slot:'#slot-card',expectConflict:true}] }`
- **steps** 1. `setup(...)`
- **expected** `create('card')` 抛 `ELEMENT_CONFLICT`；cardNumber 正常
- **assertions** `creationErrors['#slot-card'].code==='ELEMENT_CONFLICT'`；`#slot-card` 内无 iframe；cardNumber `ready`
- **cleanup** `destroy()`

### C3-05 互斥：重复同类拆分字段 → ELEMENT_CONFLICT
- **category** C3 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'cardNumber',slot:'#slot-num1'},{type:'cardNumber',slot:'#slot-num2',expectConflict:true}] }`
- **steps** 1. `setup(...)`
- **expected** 第二个 `create('cardNumber')` 抛 `ELEMENT_CONFLICT`
- **assertions** `creationErrors['#slot-num2'].code==='ELEMENT_CONFLICT'`；第一个 cardNumber `ready`
- **cleanup** `destroy()`

### C3-06 互斥：同 mode address 重复 → ELEMENT_CONFLICT
- **category** C3 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'address',slot:'#slot-b1',options:{mode:'billing'}},{type:'address',slot:'#slot-b2',options:{mode:'billing'},expectConflict:true}] }`
- **steps** 1. `setup(...)`
- **expected** 第二个 billing address 抛 `ELEMENT_CONFLICT`
- **assertions** `creationErrors['#slot-b2'].code==='ELEMENT_CONFLICT'`；第一个 billing address `ready`
- **cleanup** `destroy()`

### C3-07 互斥：expressCheckout 单例 → ELEMENT_CONFLICT
- **category** C3 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'expressCheckout',slot:'#slot-e1'},{type:'expressCheckout',slot:'#slot-e2',expectConflict:true}] }`
- **steps** 1. `setup(...)`
- **expected** 第二个 express 抛 `ELEMENT_CONFLICT`
- **assertions** `creationErrors['#slot-e2'].code==='ELEMENT_CONFLICT'`；第一个 express `ready`
- **cleanup** `destroy()`

### C3-08 销毁后重建同类互斥 Element（释放名额）
- **category** C3 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'expressCheckout',slot:'#slot-express'}] }`
- **steps**
  1. `setup(...)`（express 就绪）
  2. `elements['#slot-express'].destroy()`
  3. `createElement({type:'expressCheckout',slot:'#slot-express',options:{paymentMethods:{applePay:{buttonType:'buy'}}}})` 并 `mount('#slot-express')`
- **expected** destroy 后名额释放；重建成功、重新 `ready`，不抛 `ELEMENT_CONFLICT`；旧 iframe 已移除、新 iframe 就绪
- **assertions** 第二次 `createElement` 的 `CreateRecord.ok===true`（无冲突）；`#slot-express` 内为新 iframe 且 `ready`
- **cleanup** `destroy()`

### C3-09 session 收集标记驱动的地址场景（collectShippingAddress）
- **category** C3 · **priority** P1 · **real-device-condition** `requires-session-variant`
- **preconditions** 测试后端能建出 `collectShippingAddress:true` 的 session
- **harness-config** `{ session:'auto'(shipping variant), elements:[{type:'address',slot:'#slot-ship',options:{mode:'shipping'}}] }`
- **steps** 1. `setup(...)` 2. `getSession()`
- **expected** session 视图 `collectShippingAddress===true`；shipping address Element 就绪并与之协同
- **assertions** `getSession().collectShippingAddress===true`；shipping address `elementReady`
- **cleanup** `destroy()`
- **note** 沙箱商户无法控制该标记时，降级为「仅断言 session 视图字段被正确透传」（`collectBillingAddress`/`collectShippingAddress` 为布尔且与建单一致），不强依赖真实收集 UI。

---

## 5. C4 主题定制（colorScheme + variables 整体风格）

### C4-01 初始 colorScheme=dark（首帧无闪，src 透传）
- **category** C4 · **priority** P0 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', appearance:{ colorScheme:'dark' }, elements:[{type:'card',slot:'#slot-card'}] }`
- **steps** 1. `setup(...)`
- **expected** card iframe src 查询串含 `colorScheme=dark`；iframe 内渲染深色（深底浅字）
- **assertions** src 含 `colorScheme=dark`；跨 iframe 读 hosted 文档 `documentElement` 命中 `.dark`（同源 hosted 可读）或 body 背景为深色值
- **cleanup** `destroy()`

### C4-02 初始 colorScheme=light / auto
- **category** C4 · **priority** P1 · **real-device-condition** `none`（auto 变体用 emulate `prefers-color-scheme`）
- **harness-config** 两变体：`appearance:{colorScheme:'light'}`、`appearance:{colorScheme:'auto'}`；均 `elements:[{type:'card',slot:'#slot-card'}]`
- **steps** 1. light 变体 `setup` 2. `reset()` 3. emulate 系统深色后 auto 变体 `setup`
- **expected** light → 浅色；auto → 跟随系统（emulate dark 时呈深色）
- **assertions** light 变体 src 含 `colorScheme=light` 且渲染浅色；auto 变体在 emulate dark 下渲染深色
- **cleanup** 每变体 `destroy()`

### C4-03 运行时切换 colorScheme（updateCheckout，跨 iframe 同步）
- **category** C4 · **priority** P0 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', appearance:{colorScheme:'light'}, elements:[{type:'cardNumber',slot:'#slot-num'},{type:'cardExpiry',slot:'#slot-exp'},{type:'cardCvc',slot:'#slot-cvc'}] }`
- **steps** 1. `setup(...)` 2. `updateCheckout({ appearance:{ colorScheme:'dark' } })`
- **expected** 三字段 iframe 全部实时切到深色
- **assertions** `updateCheckout` resolve；轮询跨 iframe 读取，三 iframe 均在超时内变深色（`.dark` 或背景色）
- **cleanup** `destroy()`

### C4-04 初始 variables 全集（7 个白名单设计变量）
- **category** C4 · **priority** P0 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', appearance:{ variables:{ colorPrimary:'#7c3aed', colorBackground:'#0b1020', colorText:'#e5e7eb', colorBorder:'#334155', colorDanger:'#ef4444', borderRadius:'12px', fontFamily:'Georgia, serif' } }, elements:[{type:'card',slot:'#slot-card'}] }`
- **steps** 1. `setup(...)`
- **expected** card iframe src 含 `appearance=<encoded JSON>`；iframe 内样式反映各变量
- **assertions** src 含 `appearance=`；跨 iframe 读计算样式：输入框 `border-radius≈12px`、字体族含 `Georgia`、主色/聚焦环命中 `colorPrimary`、文字色命中 `colorText`
- **cleanup** `destroy()`

### C4-05 运行时切换 variables（updateCheckout）
- **category** C4 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'card',slot:'#slot-card'}] }`
- **steps** 1. `setup(...)` 2. `updateCheckout({ appearance:{ variables:{ colorPrimary:'#16a34a', borderRadius:'2px' } } })`
- **expected** card iframe 实时应用新主色与圆角
- **assertions** 切换后计算样式 `colorPrimary` 为绿、`border-radius≈2px`
- **cleanup** `destroy()`

### C4-06 非法 variables 值被丢弃（白名单校验 + 无注入）
- **category** C4 · **priority** P2 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', appearance:{ variables:{ colorPrimary:'javascript:alert(1)', borderRadius:'999invalid' } }, elements:[{type:'card',slot:'#slot-card'}] }`
- **steps** 1. `setup(...)`
- **expected** 非法值被 hosted 白名单丢弃，iframe 仍正常 `ready`（回退默认），无脚本注入、无样式破坏
- **assertions** iframe `ready`；非法值未进入计算样式（`border-radius` 非 `999invalid`）；控制台无因注入产生的错误；无弹窗
- **cleanup** `destroy()`

---

## 6. C5 元素级定制（rules：单元素 / 组合元素精调）

### C5-01 单 target：input 定制
- **category** C5 · **priority** P0 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', appearance:{ rules:{ input:{ 'padding':'14px', 'font-size':'18px' } } }, elements:[{type:'cardNumber',slot:'#slot-num'}] }`
- **steps** 1. `setup(...)`
- **expected** field iframe 内 `[data-sunbay-el=input]` 的 padding/font-size 生效
- **assertions** 跨 iframe 读输入框计算样式 `padding≈14px`、`font-size≈18px`
- **cleanup** `destroy()`

### C5-02 多 target 组合：input + input:focus + input:invalid + label + error
- **category** C5 · **priority** P0 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', appearance:{ rules:{ input:{'color':'#111111'}, 'input:focus':{'outline-color':'#2563eb'}, 'input:invalid':{'color':'#dc2626'}, label:{'font-weight':'700'}, error:{'font-style':'italic'} } }, elements:[{type:'cardNumber',slot:'#slot-num'}] }`
- **steps**
  1. `setup(...)`
  2. 跨 iframe 聚焦输入框
  3. 跨 iframe 输入无效卡号 `INVALID_CARD_NUMBER`（`4111111111111112`）触发 invalid 态
- **expected** 常态/聚焦态/错误态/标签/错误文字样式分别生效
- **assertions** 聚焦后命中 focus 样式；非法输入后 `[data-sunbay-invalid]` 命中 invalid 样式；label/error 文字样式匹配
- **cleanup** `destroy()`
- **note** 使用 `INVALID_CARD_NUMBER`（Luhn 失败）触发校验态，**不用**沙箱测试卡，避免与支付链路混淆。本用例虽输入数字但为非敏感无效值；仍附加 PCI 断言（不含 `4111111111111112` 外泄到 events/parentMessages 的卡值字段）。

### C5-03 图标类 target：cardBrand + cvvIcon
- **category** C5 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', appearance:{ rules:{ cardBrand:{'opacity':'0.6'}, cvvIcon:{'opacity':'0.4'} } }, elements:[{type:'cardNumber',slot:'#slot-num'},{type:'cardCvc',slot:'#slot-cvc'}] }`
- **steps** 1. `setup(...)`
- **expected** 卡品牌图标容器 / CVV 图标样式生效
- **assertions** 对应 `data-sunbay-el` 节点计算样式 `opacity` 匹配
- **cleanup** `destroy()`

### C5-04 组合元素各自独立 per-element appearance
- **category** C5 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'cardNumber',slot:'#slot-num',options:{appearance:{rules:{input:{'color':'#ff0000'}}}}},{type:'cardCvc',slot:'#slot-cvc',options:{appearance:{rules:{input:{'color':'#0000ff'}}}}}] }`
- **steps** 1. `setup(...)`
- **expected** cardNumber 输入文字红、cardCvc 输入文字蓝；各自 appearance 独立，不互相污染
- **assertions** 两 iframe 输入框 `color` 分别为红/蓝（跨 iframe 计算样式）
- **cleanup** `destroy()`

### C5-05 非白名单 rule 属性被丢弃
- **category** C5 · **priority** P2 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', appearance:{ rules:{ input:{ 'position':'fixed', 'z-index':'99999', 'color':'#123456' } } }, elements:[{type:'cardNumber',slot:'#slot-num'}] }`
- **steps** 1. `setup(...)`
- **expected** 非白名单属性（position/z-index）被丢弃，白名单属性（color）生效
- **assertions** 输入框 `color≈#123456`；`position` 非 `fixed`
- **cleanup** `destroy()`

---

## 7. C6 钱包按钮定制（expressCheckout）

> 本类大部分断言是**配置是否正确透传并在真实 iframe 渲染**；钱包按钮主题/文案全集由已有
> 单测覆盖，真机取代表值验透传链路。「钱包实际拉起」单列 C6-05 并标真机条件。

### C6-01 钱包开关：applePay=false 强制隐藏
- **category** C6 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'expressCheckout',slot:'#slot-express',options:{paymentMethods:{applePay:false}}}] }`
- **steps** 1. `setup(...)`
- **expected** express iframe src 含 `applePay=false`；iframe 内不渲染 Apple Pay 按钮
- **assertions** src 含 `applePay=false`；跨 iframe 内无 Apple Pay 按钮节点
- **cleanup** `destroy()`

### C6-02 per-wallet buttonType 透传（Apple + Google）
- **category** C6 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'expressCheckout',slot:'#slot-express',options:{paymentMethods:{applePay:{buttonType:'buy'},googlePay:{buttonType:'checkout'}}}}] }`
- **steps** 1. `setup(...)`
- **expected** src 含 `applePayButtonType=buy&googlePayButtonType=checkout`；（环境可用时）按钮文案类型对应
- **assertions** src 含两 buttonType 参数；环境可用时按钮 `type` 属性匹配，环境不可用时仅验 src 透传（按钮不渲染属预期）
- **cleanup** `destroy()`

### C6-03 全局 buttonHeight 透传与 clamp
- **category** C6 · **priority** P2 · **real-device-condition** `none`
- **harness-config** 两变体：`buttonHeight:50`（合法）、`buttonHeight:200`（越界）；均 `elements:[{type:'expressCheckout',slot:'#slot-express',options:{buttonHeight:<上>}}]`
- **steps** 1. 分别 `setup(...)`（变体间 `reset()`）
- **expected** src 含 `buttonHeight=<n>`；（环境可用时）渲染高度：合法≈50、越界被 hosted clamp 到 64
- **assertions** src 含 `buttonHeight`；环境可用时按钮高度符合 clamp 规则（`[30,64]`），不可用时仅验 src 透传
- **cleanup** 每变体 `destroy()`

### C6-04 buttonTheme 跟随 colorScheme / 显式覆盖
- **category** C6 · **priority** P2 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', appearance:{colorScheme:'dark'}, elements:[{type:'expressCheckout',slot:'#slot-express',options:{paymentMethods:{applePay:{buttonTheme:'white-outline'}}}}] }`
- **steps** 1. `setup(...)`
- **expected** 深色下缺省主题跟随（white），显式 `buttonTheme` 覆盖为 `white-outline`
- **assertions** 环境可用时按钮主题匹配显式值；环境不可用时验 express iframe 就绪且无报错（主题由 hosted 应用，真机不可用则跳过视觉断言）
- **cleanup** `destroy()`

### C6-05 钱包实际拉起（可选，需真机真证书）
- **category** C6 · **priority** P2 · **real-device-condition** `requires-apple-pay` / `requires-google-pay` · **optional**
- **harness-config** `{ session:'auto', elements:[{type:'expressCheckout',slot:'#slot-express'}] }`
- **steps** 1. `setup(...)` 2. 点击可用钱包按钮
- **expected** 拉起对应钱包支付 sheet；产生 `paymentStateChange`
- **assertions** 环境满足：点击后出现钱包交互、`events` 含 `paymentStateChange`；环境不满足：按钮不渲染（`availableWallets` 对应键为 false）**属预期跳过，非失败**
- **cleanup** `destroy()`

---

## 8. C7 支付链路与生命周期

### C7-01 完整卡支付链路（沙箱测试卡 → paymentResult）
- **category** C7 · **priority** P0 · **real-device-condition** `requires-payment-flow`
- **harness-config** `{ session:'auto', elements:[{type:'cardNumber',slot:'#slot-num'},{type:'cardExpiry',slot:'#slot-exp'},{type:'cardCvc',slot:'#slot-cvc'}] }`
- **steps**
  1. `setup(...)`（三字段就绪）
  2. **跨 iframe 直接输入** `SANDBOX_CARD_DEFAULT`（`4012000098765439` / `12` / `2028` / `999`）到各 hosted field iframe —— **不经 SDK/harness**
  3. `confirm()`
- **expected** 收到 `paymentStateChange`，最终 `paymentResult` 为终态；`confirm` 的 `ConfirmRecord.outcome` 与同 operationId 的 `paymentResult` 对齐
- **assertions** `events` 含 `paymentResult` 且 `outcome.operationId===ConfirmRecord.operationId`；`outcome.status` 属 `succeeded|failed|pending|canceled`（沙箱预期 `succeeded`）；**附加全局 PCI 断言**
- **cleanup** `destroy()`

### C7-02 卡值不泄露（PCI 贯穿断言，独立强校验）
- **category** C7 · **priority** P0 · **real-device-condition** `requires-payment-flow`
- **harness-config** 同 C7-01
- **steps** 1–2 同 C7-01（输入沙箱测试卡）
- **expected** 父窗口 `parentMessages` 与 `events` 全程不含卡号/CVV（明文或任意编码）
- **assertions** 序列化 `parentMessages`+`events`，不出现子串 `4012000098765439`、任意 ≥8 位卡号连续子串、CVV `999`（卡上下文）
- **cleanup** `destroy()`
- **note** 本用例可与 C7-01 同一次执行复用观测数据；独立列出以强调 PCI 是必过项。

### C7-03 change 事件（empty/complete/brand，不含卡值）
- **category** C7 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'cardNumber',slot:'#slot-num'}] }`
- **steps** 1. `setup(...)` 2. 跨 iframe 逐步输入沙箱卡号
- **expected** 收到 `change`：空时 `empty:true`、填完合法卡号 `complete:true`、带 `brand`（如 visa）；**绝不含卡值**
- **assertions** change 序列呈现 `empty:false`、`complete:true`、出现 `brand`；每条 change payload 不含卡号；**附加全局 PCI 断言**
- **cleanup** `destroy()`

### C7-04 CHECKOUT_BUSY（confirm 进行中再 confirm）
- **category** C7 · **priority** P1 · **real-device-condition** `requires-payment-flow`
- **harness-config** 同 C7-01
- **steps** 1. `setup(...)` + 跨 iframe 输入沙箱卡 2. 连续两次 `confirm()`（第二次在第一次未结束前）
- **expected** 第二次 `confirm` reject `CHECKOUT_BUSY`
- **assertions** 第二次 `ConfirmRecord.error.code==='CHECKOUT_BUSY'`
- **cleanup** `destroy()`

### C7-05 focus / blur / clear 动作可调用（输入类）
- **category** C7 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'cardNumber',slot:'#slot-num'}] }`
- **steps** 1. `setup(...)` 2. `action('#slot-num','focus')` 3. 跨 iframe 输入几位数字 4. `action('#slot-num','clear')` 5. `action('#slot-num','blur')`
- **expected** 三个动作命令均被接受（Promise resolve、不抛错）；SDK 句柄确实暴露 `focus`/`blur`/`clear` 方法（输入类 Element 才有）
- **assertions**
  - `elements['#slot-num'].focus` / `.blur` / `.clear` 均为 function（expressCheckout 应为 undefined，可在 C2-04 旁证）
  - 三次 `action(...)` 的调用均 resolve 且无 `events` 中出现 `error`
- **cleanup** `destroy()`
- **note** **现状核实**：当前 hosted runtime（`Orchestrator` / `FieldApp` / `CardElementApp`）未实现 `focus`/`blur`/`clear` 命令的处理器，因此命令被接受但**可观测的 UI 清空/聚焦效果与 `focus`/`blur` 事件回传尚未落地**。故本用例只断言「API 可调用、命令被接受、输入类才有这些方法」；**不**断言 UI 清空或 `focus`/`blur` 事件。待 hosted 实现对应处理器后，再补「clear 后 `change.empty===true`、收到 `focus`/`blur` 事件」的强断言。

### C7-06 getSession / refresh / getPaymentStatus
- **category** C7 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[] }`
- **steps** 1. `setup(...)` 2. `getSession()` 3. `refresh()` 4. `getPaymentStatus()`
- **expected** 三者返回合法结构；未支付时 `getPaymentStatus().txnStatus==='I'`
- **assertions** `getSession`/`refresh` 返回含 `sessionId` 的视图且**不含** `rsaPublicKey`；`getPaymentStatus` 返回合法 `TxnStatus`（`I|S|F|R`）
- **cleanup** `destroy()`

### C7-07 实例销毁幂等 + 销毁后操作 → INSTANCE_DESTROYED
- **category** C7 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'card',slot:'#slot-card'}] }`
- **steps** 1. `setup(...)` 2. `destroy()` 3. 再 `destroy()`（幂等） 4. 销毁后调 `confirm()` 与 `getSession()`
- **expected** 二次 destroy 无副作用；销毁后操作 reject/throw `INSTANCE_DESTROYED`；所有 iframe（含 main）被移除
- **assertions** 第二次 destroy 不抛；销毁后 `confirm` 的 `ConfirmRecord.error.code==='INSTANCE_DESTROYED'`；`getSession` 抛/ reject `INSTANCE_DESTROYED`；DOM 无残留 iframe
- **cleanup** `reset()`

### C7-08 element unmount / remount
- **category** C7 · **priority** P2 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'card',slot:'#slot-card'}] }`
- **steps** 1. `setup(...)` 2. `unmount('#slot-card')` 3. `mount('#slot-card')`
- **expected** unmount 后 iframe 移除、状态回 `created`、句柄保留（仍占互斥名额）；remount 后重新 `ready`
- **assertions** unmount 后 `#slot-card` 空且 `getStatus()==='created'`；remount 后 `getStatus()==='ready'` 且 slot 内重新有 iframe
- **cleanup** `destroy()`

### C7-09 locale 运行时切换（updateCheckout）
- **category** C7 · **priority** P2 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', locale:'en', elements:[{type:'card',slot:'#slot-card'}] }`
- **steps** 1. `setup(...)` 2. `updateCheckout({ locale:'zh' })`
- **expected** iframe 内文案（label 等）由英文切到中文
- **assertions** 切换后跨 iframe 取一处已知 label，文案由英文变中文
- **cleanup** `destroy()`

### C7-10 多实例并存（同页两个独立 createCheckout）
- **category** C7 · **priority** P2 · **real-device-condition** `none`
- **harness-config** 两次 setup：
  - `setup({ session:'auto', instanceKey:'A', elements:[{type:'card',slot:'#slot-card'}] })`
  - `setup({ session:'auto', instanceKey:'B', elements:[{type:'card',slot:'#slot-card2'}] })`
- **steps** 1. 依次两次 `setup` 2. 分别读两实例 3. `destroy('A')` 4. 校验 B 不受影响 5. `destroy('B')`
- **expected** 两实例 `checkoutId` 不同；事件/transport 按 `checkoutId` 隔离不串扰；销毁 A 不影响 B
- **assertions** `instances.A.checkoutId !== instances.B.checkoutId`；两 card 各自 `ready`；`events` 中各 element 事件来源 slot 不交叉；`destroy('A')` 后 B 仍 `ready` 且可 `getSession()`
- **cleanup** `reset()`
- **note** 需要为第二个实例预留独立 slot（如 `#slot-card2`）。

---

## 9. 覆盖映射（用例 → SDK 能力）

| SDK 能力 | 覆盖用例 |
|---|---|
| createCheckout / 握手 / initialize | C1-01, C1-03, C1-04, C1-05 |
| IIFE `window.SunbayCheckout` | C1-02 |
| 嵌入模式：card / 拆分字段 / address / express | C2-01, C2-02, C2-03, C2-04, C2-06 |
| iframe 自适应高度 | C2-05 |
| 组件组合 | C3-01, C3-02 |
| 互斥（ELEMENT_CONFLICT 全规则） | C3-03~C3-07 |
| 销毁后重建 / 名额释放 | C3-08 |
| session 收集标记 | C3-09 |
| 主题：colorScheme（初始/运行时/auto） | C4-01, C4-02, C4-03 |
| 主题：variables（初始/运行时/非法丢弃） | C4-04, C4-05, C4-06 |
| 元素级 rules（单/多 target/图标/per-element/非白名单） | C5-01~C5-05 |
| 钱包按钮定制（开关/buttonType/height/theme/拉起） | C6-01~C6-05 |
| 支付链路（confirm/paymentResult/四态） | C7-01 |
| PCI 卡值不泄露 | C7-02（+ 所有填卡用例贯穿） |
| change / focus / blur / clear | C7-03, C7-05 |
| CHECKOUT_BUSY | C7-04 |
| getSession / refresh / getPaymentStatus | C7-06 |
| 生命周期：destroy 幂等 / INSTANCE_DESTROYED | C7-07 |
| unmount / remount | C7-08 |
| locale 运行时切换 | C7-09 |
| 多实例并存 / 隔离 | C7-10 |
