/**
 * 命令契约（商户 SDK → main，spec 5.2 表，真源）。
 *
 * 每命令的请求/响应类型在此定义；跨通道只传 JSON 可序列化数据。
 */

import type {
    Appearance,
    AddressInfo,
    ElementOptions,
    ElementType,
    PaymentMethodFilter,
    PublicSessionView,
    TxnStatus,
} from './types';

/** 全部命令名（spec 5.2）。 */
export type CommandName =
    | 'initialize'
    | 'createElement'
    | 'updateElement'
    | 'destroyElement'
    | 'focus'
    | 'blur'
    | 'clear'
    | 'updateCheckout'
    | 'getSession'
    | 'refresh'
    | 'getPaymentStatus'
    | 'confirm'
    | 'destroy';

/** 已知命令名集合（供调用方校验 request.name 是否受支持）。 */
export const COMMAND_NAMES: readonly CommandName[] = [
    'initialize',
    'createElement',
    'updateElement',
    'destroyElement',
    'focus',
    'blur',
    'clear',
    'updateCheckout',
    'getSession',
    'refresh',
    'getPaymentStatus',
    'confirm',
    'destroy',
];

/** 判断字符串是否为已知命令名。 */
export function isCommandName(name: string): name is CommandName {
    return (COMMAND_NAMES as readonly string[]).includes(name);
}

// --- initialize ---
export interface InitializeReq {
    sessionId: string;
    locale?: string;
    appearance?: Appearance;
    paymentMethods?: PaymentMethodFilter;
}
export interface InitializeResp {
    capabilities: string[];
    session: PublicSessionView;
}

// --- createElement ---
export interface CreateElementReq {
    elementId: string;
    type: ElementType;
    options?: ElementOptions;
}
export interface CreateElementResp {
    elementId: string;
    registered: true;
}

// --- updateElement ---
export interface UpdateElementReq {
    elementId: string;
    patch: Partial<ElementOptions>;
}
export interface UpdateElementResp {
    elementId: string;
    options: ElementOptions;
}

// --- destroyElement ---
export interface DestroyElementReq {
    elementId: string;
}
export interface DestroyElementResp {
    elementId: string;
    released: true;
}

// --- focus / blur / clear（仅输入类 Element）---
export interface ElementActionReq {
    elementId: string;
}
export interface ElementActionResp {
    elementId: string;
    done: true;
}

// --- updateCheckout（不改会话/金额）---
export interface UpdateCheckoutReq {
    locale?: string;
    appearance?: Appearance;
}
export interface UpdateCheckoutResp {
    updated: true;
}

// --- getSession / refresh ---
export type GetSessionReq = Record<string, never>;
export type GetSessionResp = PublicSessionView;

// --- getPaymentStatus（原样返回 TxnStatus，不转义）---
export type GetPaymentStatusReq = Record<string, never>;
export interface GetPaymentStatusResp {
    txnStatus: TxnStatus;
    txnId?: string;
}

// --- confirm（仅表示开始执行）---
export interface ConfirmReq {
    operationId: string;
    billingAddress?: AddressInfo;
    shippingAddress?: AddressInfo;
    customerName?: string;
    email?: string;
    returnUrl?: string;
}
export interface ConfirmResp {
    accepted: true;
}

// --- destroy ---
export type DestroyReq = Record<string, never>;
export interface DestroyResp {
    released: true;
}

/** 命令名 → 请求载荷映射。 */
export interface CommandRequestMap {
    initialize: InitializeReq;
    createElement: CreateElementReq;
    updateElement: UpdateElementReq;
    destroyElement: DestroyElementReq;
    focus: ElementActionReq;
    blur: ElementActionReq;
    clear: ElementActionReq;
    updateCheckout: UpdateCheckoutReq;
    getSession: GetSessionReq;
    refresh: GetSessionReq;
    getPaymentStatus: GetPaymentStatusReq;
    confirm: ConfirmReq;
    destroy: DestroyReq;
}

/** 命令名 → 成功响应载荷映射。 */
export interface CommandResponseMap {
    initialize: InitializeResp;
    createElement: CreateElementResp;
    updateElement: UpdateElementResp;
    destroyElement: DestroyElementResp;
    focus: ElementActionResp;
    blur: ElementActionResp;
    clear: ElementActionResp;
    updateCheckout: UpdateCheckoutResp;
    getSession: GetSessionResp;
    refresh: GetSessionResp;
    getPaymentStatus: GetPaymentStatusResp;
    confirm: ConfirmResp;
    destroy: DestroyResp;
}
