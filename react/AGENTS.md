# AGENTS.md — react (@sunbay/checkout-sdk-react)

Merchant-facing browser React SDK.

---

## Status: planned (placeholder)

The `react/` directory is currently **empty** (only `.gitkeep`) and **not
implemented**.

- Do not invent its implementation, API, build setup, or dependencies here.
- It is not yet a package and is therefore **not** part of
  `pnpm-workspace.yaml`'s `packages` (add it once it becomes a package, and
  remove the placeholder notes in the root AGENTS.md / workspace yaml).
- Intended role: provide React bindings on top of `@sunbay/checkout-sdk-js`
  (React bindings / components / hooks around `createCheckout`), sharing the
  same `@sunbay/checkout-sdk-protocol` contract and security constraints (never
  carry card data).

> When implementation begins, add `package.json` (`workspace:*` dependency on
> protocol/js), build and test configs, add the package to the workspace, then
> flesh out this file.
