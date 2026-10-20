# AGENTS.md — react（@sunbay/checkout-sdk-react）

面向商户的浏览器 React SDK。

---

## 状态：规划中（占位）

当前 `react/` **为空目录**（仅含 `.gitkeep`），**尚未实现**。

- 不要编造此处的实现、API、构建方式或依赖。
- 尚未成包，因此**未**纳入 `pnpm-workspace.yaml` 的 `packages`（成包后再加入，并取消根 AGENTS.md / workspace yaml 中的占位注释）。
- 预期定位：在 `@sunbay/checkout-sdk-js` 之上提供 React 封装（`createCheckout` 的 React 绑定 / 组件 / hooks），共用同一套 `@sunbay/checkout-sdk-protocol` 协议契约与安全约束（绝不搬运卡值）。

> 开始实现时，请补充 `package.json`（`workspace:*` 依赖 protocol/js）、构建与测试配置，并把包加入 workspace，然后完善本文件。
