/**
 * Command contract (merchant SDK → main, spec 5.2 table, source of truth).
 *
 * The request/response types for each command are defined here; only JSON-serializable data is sent
 * across the channel.
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

/** All command names (spec 5.2). */
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

/** Set of known command names (for callers to validate whether request.name is supported). */
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

/** Determine whether a string is a known command name. */
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

// --- focus / blur / clear (input-type Elements only) ---
export interface ElementActionReq {
    elementId: string;
}
export interface ElementActionResp {
    elementId: string;
    done: true;
}

// --- updateCheckout (does not change session/amount) ---
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

// --- getPaymentStatus (returns TxnStatus verbatim, no translation) ---
export type GetPaymentStatusReq = Record<string, never>;
export interface GetPaymentStatusResp {
    txnStatus: TxnStatus;
    txnId?: string;
}

// --- confirm (only indicates that execution has started) ---
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

/** Command name → request payload mapping. */
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

/** Command name → success response payload mapping. */
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
