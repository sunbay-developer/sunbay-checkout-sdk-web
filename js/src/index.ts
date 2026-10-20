/**
 * @sunbay/checkout-js 公共入口（真源）。
 *
 * 导出 `createCheckout` 入口、`CheckoutInstance` / `CheckoutElement` 句柄类型，
 * 以及协议公开类型（供 TS 使用者消费）。
 * IIFE 产物下，额外在 `window.SunbayCheckout` 暴露 `{ createCheckout }`。
 */

export { createCheckout } from './createCheckout';
export type {
    CreateCheckoutOptions,
    TransportFactory,
} from './createCheckout';

export { CheckoutInstance } from './CheckoutInstance';
export type {
    CheckoutInstanceOptions,
    ConfirmOptions,
    InstanceTransport,
} from './CheckoutInstance';

export { CheckoutElement } from './Element';
export type { CheckoutElementOptions, ElementTransport } from './Element';

export type { Env } from './config/env';

// 协议公开类型（面向 TS 使用者的契约）。
export {
    ErrorCode,
    type ErrorCodeValue,
    type CheckoutError,
    type CheckoutErrorCategory,
    type PaymentOutcome,
    type PublicSessionView,
    type PublicPaymentMethod,
    type PublicProductLine,
    type PaymentMethod,
    type PaymentMethodFilter,
    type Appearance,
    type AddressInfo,
    type TxnStatus,
    type ElementType,
    type ElementOptions,
    type ElementStatus,
    type CardElementOptions,
    type CardFieldElementOptions,
    type AddressElementOptions,
    type ExpressCheckoutElementOptions,
} from '@sunbay/checkout-sdk-protocol';

import { createCheckout } from './createCheckout';

/**
 * IIFE / 浏览器全局：挂载 `window.SunbayCheckout = { createCheckout }`。
 *
 * tsup 的 IIFE 产物已以 `globalName: 'SunbayCheckout'` 暴露模块导出，此处显式确保
 * `window.SunbayCheckout.createCheckout` 可用（同时兼容未来再导出更多入口）。
 */
if (typeof window !== 'undefined') {
    const w = window as typeof window & {
        SunbayCheckout?: { createCheckout: typeof createCheckout };
    };
    w.SunbayCheckout = { ...(w.SunbayCheckout ?? {}), createCheckout };
}

/** 包版本（占位，随发布流程注入）。 */
export const version = '0.0.0';
