/**
 * 事件契约（main → 商户 SDK，spec 5.3 表，真源）。
 *
 * 公开事件仅暴露 empty/complete/brand/error 等允许状态，**绝不含卡值**，
 * 不提供卡数据 getValue。`on` 注册后不重放历史事件。
 */

import type {
    AvailableWallets,
    CheckoutError,
    PaymentAction,
    PaymentMethod,
    PaymentOutcome,
    PublicPaymentMethod,
} from './types';

/** 全部事件名（spec 5.3）。 */
export type EventName =
    | 'ready'
    | 'change'
    | 'focus'
    | 'blur'
    | 'loadError'
    | 'elementReady'
    | 'availablePaymentMethodsChange'
    | 'expressAvailabilityChange'
    | 'paymentStateChange'
    | 'paymentResult'
    | 'error';

/** 已知事件名集合。 */
export const EVENT_NAMES: readonly EventName[] = [
    'ready',
    'change',
    'focus',
    'blur',
    'loadError',
    'elementReady',
    'availablePaymentMethodsChange',
    'expressAvailabilityChange',
    'paymentStateChange',
    'paymentResult',
    'error',
];

/** 判断字符串是否为已知事件名。 */
export function isEventName(name: string): name is EventName {
    return (EVENT_NAMES as readonly string[]).includes(name);
}

// --- 输入 Element 事件 ---
export interface ReadyEvent {
    elementId: string;
}
export interface ElementReadyEvent {
    elementId: string;
    /** 仅 expressCheckout Element ready 时携带：各钱包可用性。 */
    availableWallets?: AvailableWallets;
}
export interface ChangeEvent {
    elementId: string;
    empty: boolean;
    complete: boolean;
    error?: CheckoutError;
    /** 仅卡号字段允许携带 brand；绝不含卡值。 */
    brand?: string;
}
export interface FocusEvent {
    elementId: string;
}
export interface BlurEvent {
    elementId: string;
}
export interface LoadErrorEvent {
    elementId: string;
    error: CheckoutError;
}

// --- Express 事件 ---
export interface AvailablePaymentMethodsChangeEvent {
    availablePaymentMethods: PublicPaymentMethod[];
}

/**
 * express 可用钱包变化事件（spec 6）。
 * 专用于 expressCheckout：以 AvailableWallets 表达各钱包可用性，
 * 与 AvailablePaymentMethodsChangeEvent（PublicPaymentMethod[]）并存，互不破坏。
 */
export interface ExpressAvailabilityChangeEvent {
    availableWallets: AvailableWallets;
}

// --- Checkout 级事件 ---
export interface PaymentStateChangeEvent {
    operationId: string;
    method: PaymentMethod;
    /** 过程状态；requiresAction 时携带 action 信息。 */
    state: string;
    action?: PaymentAction;
}
export interface PaymentResultEvent {
    operationId: string;
    method: PaymentMethod;
    outcome: PaymentOutcome;
}
export interface ErrorEvent {
    /** 异步主动流程错误；可含 operationId（如已创建）。 */
    operationId?: string;
    error: CheckoutError;
}

/** 事件名 → 载荷映射。 */
export interface EventPayloadMap {
    ready: ReadyEvent;
    change: ChangeEvent;
    focus: FocusEvent;
    blur: BlurEvent;
    loadError: LoadErrorEvent;
    elementReady: ElementReadyEvent;
    availablePaymentMethodsChange: AvailablePaymentMethodsChangeEvent;
    expressAvailabilityChange: ExpressAvailabilityChangeEvent;
    paymentStateChange: PaymentStateChangeEvent;
    paymentResult: PaymentResultEvent;
    error: ErrorEvent;
}
