/**
 * @sunbay/checkout-js public entry (source of truth).
 *
 * Exports the `createCheckout` entry, the `CheckoutInstance` / `CheckoutElement` handle types,
 * and the public protocol types (for TS consumers).
 * In the IIFE build, additionally exposes `{ createCheckout }` on `window.SunbayCheckout`.
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
export type { CheckoutElementOptions, ElementTransport, MountOptions } from './Element';

export type { Env } from './config/env';

// Public protocol types (the contract for TS consumers).
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
    type AvailableWallets,
    type ApplePayOptions,
    type GooglePayOptions,
    type ApplePayButtonTheme,
    type GooglePayButtonTheme,
    type ApplePayButtonType,
    type GooglePayButtonType,
    type PaymentAction,
    type WalletErrorStage,
    type EventName,
    type EventPayloadMap,
    type ErrorEvent,
    type PaymentResultEvent,
    type PaymentStateChangeEvent,
    type ExpressAvailabilityChangeEvent,
    type ElementReadyEvent,
    type ChangeEvent,
    type LoadErrorEvent,
    type ReadyEvent,
    type FocusEvent,
    type BlurEvent,
    type AppearanceVariables,
    type AppearanceRuleTarget,
    type AppearanceRuleStyle,
} from '@sunbay/checkout-sdk-protocol';

import { createCheckout } from './createCheckout';

/**
 * IIFE / browser global: mount `window.SunbayCheckout = { createCheckout }`.
 *
 * The tsup IIFE build already exposes the module exports via `globalName: 'SunbayCheckout'`;
 * this explicitly ensures `window.SunbayCheckout.createCheckout` is available (while staying
 * compatible with re-exporting more entries in the future).
 */
if (typeof window !== 'undefined') {
    const w = window as typeof window & {
        SunbayCheckout?: { createCheckout: typeof createCheckout };
    };
    w.SunbayCheckout = { ...(w.SunbayCheckout ?? {}), createCheckout };
}

/**
 * Package version. Injected at build time by tsup's `define` from `package.json` as
 * `__SDK_VERSION__` (see tsup.config.ts), so the code's version always stays in sync with
 * package.json. Environments without a build (e.g. vitest running src directly) have no such
 * define and fall back to `'0.0.0'`.
 */
declare const __SDK_VERSION__: string;
export const version: string =
    typeof __SDK_VERSION__ !== 'undefined' ? __SDK_VERSION__ : '0.0.0';
