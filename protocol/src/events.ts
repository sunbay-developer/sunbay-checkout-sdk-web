/**
 * Event contract (main → merchant SDK, spec 5.3 table, source of truth).
 *
 * Public events only expose allowed states such as empty/complete/brand/error, and **never contain
 * card values**; no card-data getValue is provided. After `on` registration, historical events are
 * not replayed.
 */

import type {
    AvailableWallets,
    CheckoutError,
    PaymentAction,
    WalletErrorStage,
    PaymentMethod,
    PaymentOutcome,
} from './types';

/** All event names (spec 5.3). */
export type EventName =
    | 'ready'
    | 'change'
    | 'focus'
    | 'blur'
    | 'loadError'
    | 'elementReady'
    | 'expressAvailabilityChange'
    | 'paymentStateChange'
    | 'paymentResult'
    | 'error'
    | 'warning';

/** Set of known event names. */
export const EVENT_NAMES: readonly EventName[] = [
    'ready',
    'change',
    'focus',
    'blur',
    'loadError',
    'elementReady',
    'expressAvailabilityChange',
    'paymentStateChange',
    'paymentResult',
    'error',
    'warning',
];

/** Determine whether a string is a known event name. */
export function isEventName(name: string): name is EventName {
    return (EVENT_NAMES as readonly string[]).includes(name);
}

// --- Input Element events ---
export interface ReadyEvent {
    elementId: string;
}
export interface ElementReadyEvent {
    elementId: string;
    /** Only carried when the expressCheckout Element is ready: per-wallet availability. */
    availableWallets?: AvailableWallets;
}
export interface ChangeEvent {
    elementId: string;
    empty: boolean;
    complete: boolean;
    error?: CheckoutError;
    /** Only the card number field may carry brand; never contains card values. */
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

// --- Express events ---
/**
 * Express available-wallets change event (spec 6).
 * Dedicated to expressCheckout: uses AvailableWallets to express the availability of each wallet
 * (Apple/Google Pay).
 */
export interface ExpressAvailabilityChangeEvent {
    availableWallets: AvailableWallets;
}

// --- Checkout-level events ---
export interface PaymentStateChangeEvent {
    operationId: string;
    method: PaymentMethod;
    /** Intermediate state; carries action info when requiresAction. */
    state: string;
    action?: PaymentAction;
}
export interface PaymentResultEvent {
    operationId: string;
    method: PaymentMethod;
    outcome: PaymentOutcome;
}
export interface ErrorEvent {
    /** Error in an asynchronous proactive flow; may include operationId (if already created). */
    operationId?: string;
    /** Payment method the error relates to, if any. */
    method?: PaymentMethod;
    /** Payment flow stage in which the error occurred, if applicable (wallet and card flows). */
    stage?: WalletErrorStage;
    error: CheckoutError;
}

/**
 * Cross-platform registry of `warning` event codes (single source of truth for Web, iOS, Android).
 * Warnings are non-fatal: the offending input was ignored. A platform that needs a new code adds it
 * here (and to the docs table) so every SDK shares one vocabulary.
 */
export const WARNING_CODES = {
    /** A `paymentMethods` filter identifier matched nothing (unknown / not offered). */
    PAYMENT_METHOD_FILTER_IGNORED: 'PAYMENT_METHOD_FILTER_IGNORED',
    /** An expressCheckout option was not whitelisted or had an invalid value. */
    EXPRESS_OPTION_IGNORED: 'EXPRESS_OPTION_IGNORED',
    /** A host-provided billing/shipping address was incomplete, so it was treated as not provided. */
    ADDRESS_INCOMPLETE: 'ADDRESS_INCOMPLETE',
    /** A host-provided address was ignored because our Address Element owns that mode. */
    ADDRESS_ENTRY_IGNORED: 'ADDRESS_ENTRY_IGNORED',
    /**
     * The wallet (Apple Pay / Google Pay) payment parameters delivered by the session were missing
     * or invalid, so that wallet is not offered. Registered for the native SDKs (iOS first); the Web
     * runtime currently only logs this condition and does not emit the event.
     */
    WALLET_PARAMS_INVALID: 'WALLET_PARAMS_INVALID',
} as const;

/** Warning code (non-fatal; the offending input was ignored). */
export type WarningCode = (typeof WARNING_CODES)[keyof typeof WARNING_CODES];

/**
 * Non-fatal warning: some merchant-supplied input was ignored instead of failing the call
 * (e.g. an unknown `paymentMethods` filter identifier, or a non-whitelisted Express option).
 */
export interface WarningEvent {
    code: WarningCode;
    /** The ignored identifiers / option paths. */
    ignored: string[];
    /** Human-readable reason (may list the accepted values). */
    reason: string;
}

/** Event name → payload mapping. */
export interface EventPayloadMap {
    ready: ReadyEvent;
    change: ChangeEvent;
    focus: FocusEvent;
    blur: BlurEvent;
    loadError: LoadErrorEvent;
    elementReady: ElementReadyEvent;
    expressAvailabilityChange: ExpressAvailabilityChangeEvent;
    paymentStateChange: PaymentStateChangeEvent;
    paymentResult: PaymentResultEvent;
    error: ErrorEvent;
    warning: WarningEvent;
}
