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
    | 'error';

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
    error: CheckoutError;
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
}
