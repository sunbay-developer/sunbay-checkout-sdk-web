/**
 * CheckoutInstance — the merchant-side checkout instance handle (spec 4 / 7 / 8).
 *
 * Responsibilities:
 * - Constructed by `createCheckout` after a successful handshake + initialize (holds the ready
 *   transport, runtimeId, capabilities, and the initial PublicSessionView).
 * - `create` assembles and returns a {@link CheckoutElement}, maintaining a **mutual-exclusion
 *   registry** (card and split fields are mutually exclusive, same-mode addresses are mutually
 *   exclusive, expressCheckout is a singleton → `ELEMENT_CONFLICT`).
 * - `confirm` generates an operationId, sends the confirm command to obtain accepted, and the
 *   Promise is fulfilled by a later `paymentResult` event with the same operationId; calling
 *   confirm again while in progress → `CHECKOUT_BUSY`.
 * - `getSession/refresh/getPaymentStatus/updateCheckout` pass through to the corresponding commands.
 * - `destroy` is idempotent: releases Elements, unbinds listeners, rejects the pending confirm with
 *   INSTANCE_DESTROYED, sends the destroy command and destroys the transport; any late
 *   `paymentResult` afterwards is ignored.
 *
 * Security constraint (AGENTS/spec): this layer only ferries protocol commands/events and
 * **never touches card values**.
 */

import { CheckoutElement, type CheckoutElementOptions } from './Element';
import {
    ErrorCode,
    type Appearance,
    type CheckoutError,
    type CommandName,
    type ConfirmReq,
    type ElementOptions,
    type ElementType,
    type EventName,
    type EventPayloadMap,
    type GetPaymentStatusResp,
    type PaymentOutcome,
    type PaymentResultEvent,
    type PublicSessionView,
    type UpdateCheckoutReq,
} from '@sunbay/checkout-sdk-protocol';

/**
 * The minimal transport interface CheckoutInstance depends on (satisfied by MainFrameTransport).
 *
 * Adds `onHello/createHiddenIframe/destroy` beyond ElementTransport, used by createCheckout for
 * handshake wiring and for instance destruction. Tests can inject a mock.
 */
export interface InstanceTransport {
    request(name: CommandName, payload: unknown): Promise<unknown>;
    on(event: EventName, handler: (payload: unknown) => void): void;
    off(event: EventName, handler: (payload: unknown) => void): void;
    onHello(handler: (hello: unknown) => void): void;
    setRuntimeId(runtimeId: string): void;
    createHiddenIframe(): unknown;
    destroy(): void;
}

/** CheckoutInstance constructor parameters (assembled by createCheckout). */
export interface CheckoutInstanceOptions {
    /** Unique checkout id. */
    checkoutId: string;
    /** Negotiated runtime id (from RuntimeHello). */
    runtimeId: string;
    /** Hosted page origin (without a trailing slash). */
    hostOrigin: string;
    /** The ready transport. */
    transport: InstanceTransport;
    /** The capabilities returned by initialize. */
    capabilities: string[];
    /** The initial session view returned by initialize. */
    session: PublicSessionView;
    /**
     * Initial appearance customization (from createCheckout's appearance).
     * Passed through to every created Element and serialized into its iframe src (no flash on the
     * first frame):
     * - colorScheme appended as `&colorScheme=`;
     * - variables/rules appended as `&appearance=` (only when non-empty).
     * Not appended when absent. Runtime switching goes through the updateCheckout command.
     */
    appearance?: Appearance;
}

/** Default time (ms) `confirm()` waits for a terminal outcome before resolving `pending`. */
export const CONFIRM_RESULT_DEADLINE_MS = 120_000;

/**
 * Optional confirm parameters (aligned with ConfirmReq, minus the instance-generated operationId,
 * plus two SDK-only options that are never sent to the runtime).
 */
export type ConfirmOptions = Omit<ConfirmReq, 'operationId'> & {
    /**
     * Called synchronously with the generated operationId, before the `confirm` command is sent.
     * Lets the merchant persist the id early (e.g. to reconcile after a timeout or page reload).
     */
    onOperation?: (operationId: string) => void;
    /**
     * Per-call override of the result watchdog in milliseconds (default
     * {@link CONFIRM_RESULT_DEADLINE_MS}). Must be a positive finite number, otherwise the default
     * applies.
     */
    resultTimeoutMs?: number;
};

/** Pairing record for a pending confirm. */
interface PendingConfirm {
    operationId: string;
    /** Whether the merchant-facing Promise has already settled (the slot may still be held). */
    settled: boolean;
    resolve: (outcome: PaymentOutcome) => void;
    reject: (reason: CheckoutError) => void;
    /** Result watchdog timer. */
    watchdog: ReturnType<typeof setTimeout> | null;
    /** txnId of the most recent non-terminal `pending` outcome, if any. */
    lastPendingTxnId: string | undefined;
}

/** The set of split card field types. */
const CARD_FIELD_TYPES: readonly ElementType[] = ['cardNumber', 'cardExpiry', 'cardCvc'];

/** Generate a unique id. */
function genId(prefix: string): string {
    const rand = Math.random().toString(36).slice(2);
    return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

/** Construct a structured CheckoutError. */
function makeError(
    code: string,
    message: string,
    category: CheckoutError['category'] = 'configuration'
): CheckoutError {
    return {
        code,
        message,
        category,
        errorId: genId('err'),
    };
}

export class CheckoutInstance {
    /** Unique checkout id. */
    readonly checkoutId: string;
    /** Negotiated runtime id. */
    readonly runtimeId: string;
    /** Negotiated capability set. */
    readonly capabilities: readonly string[];

    private readonly hostOrigin: string;
    private readonly transport: InstanceTransport;
    private session: PublicSessionView;
    /** Initial appearance customization (passed through to each created Element's iframe src). */
    private readonly appearance: Appearance | undefined;

    /** Created Elements (indexed by elementId). */
    /**
     * The **single source of truth** for the mutual-exclusion registry: elementId → the created
     * CheckoutElement. Mutual-exclusion decisions are derived live from this Map (see
     * {@link assertNoConflict}); an element's `destroy()` removes itself from this Map via
     * {@link releaseElement} to free the slot (allowing a mutually-exclusive Element of the same
     * kind to be recreated after destruction).
     */
    private readonly elements = new Map<string, CheckoutElement>();

    /** The current pending confirm (at most one at a time). */
    private pendingConfirm: PendingConfirm | null = null;
    /** The paymentResult event subscription handler (unbound on destroy). */
    private readonly paymentResultHandler: (payload: unknown) => void;

    private destroyed = false;

    constructor(opts: CheckoutInstanceOptions) {
        this.checkoutId = opts.checkoutId;
        this.runtimeId = opts.runtimeId;
        this.capabilities = opts.capabilities;
        this.hostOrigin = opts.hostOrigin;
        this.transport = opts.transport;
        this.session = opts.session;
        this.appearance = opts.appearance;

        this.paymentResultHandler = (payload: unknown): void => {
            this.handlePaymentResult(payload);
        };
        this.transport.on('paymentResult', this.paymentResultHandler);
    }

    /**
     * Create an Element handle (not auto-mounted; a mutual-exclusion conflict throws ELEMENT_CONFLICT).
     *
     * Mutual-exclusion rules (spec 6):
     * - The combined `card` and any split field (cardNumber/cardExpiry/cardCvc) are mutually exclusive.
     * - An address with the same `mode` (billing/shipping) cannot be duplicated.
     * - `expressCheckout` is a singleton.
     *
     * @param type - Element type.
     * @param options - Initial Element configuration.
     * @returns The newly created CheckoutElement.
     * @throws INSTANCE_DESTROYED when already destroyed; ELEMENT_CONFLICT on a mutual-exclusion conflict.
     */
    create(type: ElementType, options?: ElementOptions): CheckoutElement {
        this.assertAlive();
        this.assertNoConflict(type, options);

        const elementId = genId('el');
        const elementOpts: CheckoutElementOptions = {
            elementId,
            type,
            hostOrigin: this.hostOrigin,
            checkoutId: this.checkoutId,
            transport: this.transport,
            initialOptions: options,
            colorScheme: this.appearance?.colorScheme,
            appearance: this.appearance,
            onDestroy: (id: string) => this.releaseElement(id),
        };
        const element = CheckoutElement.create(elementOpts);
        this.elements.set(elementId, element);
        return element;
    }

    /**
     * Initiate a payment confirmation. Generates an operationId, sends the `confirm` command, and
     * returns a Promise fulfilled by `paymentResult` events with the same operationId.
     *
     * Behavior changes in 0.0.7: previously the Promise resolved on the first `paymentResult`,
     * including a non-final `pending` outcome. Now it resolves ONLY on a terminal outcome
     * (`succeeded` | `failed` | `canceled`); a `pending` outcome keeps it waiting.
     *
     * Watchdog: if no terminal outcome arrives within `resultTimeoutMs` (default
     * {@link CONFIRM_RESULT_DEADLINE_MS} = 120000ms) the Promise resolves
     * `{ status: 'pending', operationId, txnId? }`. This is NOT a failure: the payment may still
     * complete, so never treat it as failed and never retry blindly. Reconcile with
     * `getPaymentStatus()` or the `paymentResult` event.
     *
     * Slot semantics (duplicate-submit protection): the confirm slot stays occupied until a
     * terminal outcome arrives or `destroy()` is called. While it is occupied another `confirm()`
     * rejects with `CHECKOUT_BUSY`; this also holds after the watchdog resolved `pending`, and later
     * terminal outcomes are still delivered through `on('paymentResult', ...)`.
     *
     * If the `confirm` command is rejected by the runtime the payment was not started: the Promise
     * rejects with that error and the slot is freed. If the command itself times out
     * (`REQUEST_TIMEOUT`) the runtime may have started the payment: the Promise rejects with the
     * error augmented with `paymentStateKnown: false`, the slot stays occupied and a later terminal
     * `paymentResult` for this operation frees it. Do not retry; reconcile with `getPaymentStatus()`.
     *
     * `error` events with `paymentStateKnown === false` are informational and do not settle the
     * Promise.
     *
     * @param opts - Optional billing/shipping address, name, email, returnUrl, plus `onOperation`
     *               and `resultTimeoutMs`.
     * @returns The terminal PaymentOutcome, or `{ status: 'pending' }` when the watchdog fires.
     * @throws rejects INSTANCE_DESTROYED when destroyed; rejects CHECKOUT_BUSY when in progress.
     */
    confirm(opts?: ConfirmOptions): Promise<PaymentOutcome> {
        if (this.destroyed) {
            return Promise.reject(
                makeError(ErrorCode.INSTANCE_DESTROYED, 'Checkout instance has been destroyed', 'runtime')
            );
        }
        if (this.pendingConfirm) {
            return Promise.reject(
                makeError(ErrorCode.CHECKOUT_BUSY, 'A payment confirmation is already in progress', 'runtime')
            );
        }

        // SDK-only options never go on the wire.
        const { onOperation, resultTimeoutMs, ...rest } = opts ?? {};
        const operationId = genId('op');
        const payload: ConfirmReq = { ...rest, operationId };
        const deadline =
            typeof resultTimeoutMs === 'number' && Number.isFinite(resultTimeoutMs) && resultTimeoutMs > 0
                ? resultTimeoutMs
                : CONFIRM_RESULT_DEADLINE_MS;

        return new Promise<PaymentOutcome>((resolve, reject) => {
            // Reserve the slot first, to prevent a concurrent confirm before accepted.
            const entry: PendingConfirm = {
                operationId,
                settled: false,
                resolve,
                reject,
                watchdog: null,
                lastPendingTxnId: undefined,
            };
            this.pendingConfirm = entry;

            entry.watchdog = setTimeout(() => {
                entry.watchdog = null;
                if (entry.settled) {
                    return;
                }
                entry.settled = true;
                // Not a failure and not a rejection: the state is unknown. The slot stays held.
                const outcome: PaymentOutcome =
                    entry.lastPendingTxnId !== undefined
                        ? { status: 'pending', operationId, txnId: entry.lastPendingTxnId }
                        : { status: 'pending', operationId };
                resolve(outcome);
            }, deadline);

            // Expose the operation id before the command leaves; a throwing callback must not break
            // the payment flow, so surface its error asynchronously.
            if (typeof onOperation === 'function') {
                try {
                    onOperation(operationId);
                } catch (err) {
                    setTimeout(() => {
                        throw err;
                    }, 0);
                }
            }

            this.transport.request('confirm', payload).catch((err: unknown) => {
                if (this.pendingConfirm !== entry) {
                    return;
                }
                const error = err as CheckoutError;
                if (error && error.code === ErrorCode.REQUEST_TIMEOUT) {
                    // The runtime may have started the payment: keep the slot, mark state unknown.
                    if (!entry.settled) {
                        entry.settled = true;
                        this.clearWatchdog(entry);
                        reject({ ...error, paymentStateKnown: false });
                    }
                    return;
                }
                // The runtime did not accept the command: free the slot and reject.
                this.pendingConfirm = null;
                this.clearWatchdog(entry);
                if (!entry.settled) {
                    entry.settled = true;
                    reject(error);
                }
            });
        });
    }

    /**
     * Get the latest session view (passes through the getSession command and writes back the local snapshot).
     *
     * @returns The latest PublicSessionView.
     * @throws rejects INSTANCE_DESTROYED when destroyed.
     */
    async getSession(): Promise<PublicSessionView> {
        this.assertAlive();
        const resp = (await this.transport.request('getSession', {})) as PublicSessionView;
        this.session = resp;
        return resp;
    }

    /**
     * Refresh the session (passes through the refresh command and writes back the local snapshot).
     *
     * @returns The refreshed PublicSessionView.
     * @throws rejects INSTANCE_DESTROYED when destroyed.
     */
    async refresh(): Promise<PublicSessionView> {
        this.assertAlive();
        const resp = (await this.transport.request('refresh', {})) as PublicSessionView;
        this.session = resp;
        return resp;
    }

    /**
     * Query the payment status (returns TxnStatus as-is, no transformation).
     *
     * @returns txnStatus (may include txnId).
     * @throws rejects INSTANCE_DESTROYED when destroyed.
     */
    async getPaymentStatus(): Promise<GetPaymentStatusResp> {
        this.assertAlive();
        return (await this.transport.request('getPaymentStatus', {})) as GetPaymentStatusResp;
    }

    /**
     * Update the checkout appearance/locale (does not change the session or the amount).
     *
     * @param patch - locale / appearance delta.
     * @throws rejects INSTANCE_DESTROYED when destroyed.
     */
    async updateCheckout(patch: { locale?: string; appearance?: Appearance }): Promise<void> {
        this.assertAlive();
        const payload: UpdateCheckoutReq = patch;
        await this.transport.request('updateCheckout', payload);
    }

    /**
     * Register a Checkout-level event handler (passes through the transport).
     *
     * @param event - Event name.
     * @param handler - Callback.
     * @throws INSTANCE_DESTROYED when destroyed.
     */
    on<E extends EventName>(event: E, handler: (payload: EventPayloadMap[E]) => void): void {
        this.assertAlive();
        // The only typed→loose cast: the transport is loosely typed and the protocol guarantees the
        // payload shape per event name. The same function identity is passed, so `off` works as is.
        this.transport.on(event, handler as (payload: unknown) => void);
    }

    /**
     * Unregister an event handler (safe to call after destruction).
     *
     * @param event - Event name.
     * @param handler - The previously registered callback.
     */
    off<E extends EventName>(event: E, handler: (payload: EventPayloadMap[E]) => void): void {
        this.transport.off(event, handler as (payload: unknown) => void);
    }

    /**
     * Destroy the instance: idempotent. Releases all Elements, unbinds the paymentResult listener,
     * rejects the pending confirm with INSTANCE_DESTROYED, sends the destroy command and destroys
     * the transport. Any late paymentResult afterwards is ignored and does not overwrite an already
     * settled Promise.
     */
    destroy(): void {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;

        // Release all Element handles.
        for (const element of this.elements.values()) {
            element.destroy();
        }
        this.elements.clear();

        // Unbind the paymentResult listener (no handler can be reached by a late result afterwards).
        this.transport.off('paymentResult', this.paymentResultHandler);

        // Reject the pending confirm with INSTANCE_DESTROYED.
        if (this.pendingConfirm) {
            const entry = this.pendingConfirm;
            this.pendingConfirm = null;
            this.clearWatchdog(entry);
            if (!entry.settled) {
                entry.settled = true;
                entry.reject(
                    makeError(ErrorCode.INSTANCE_DESTROYED, 'Checkout instance has been destroyed', 'runtime')
                );
            }
        }

        // Notify the hosted side and destroy the transport (request after destroy is rejected by the transport itself).
        void Promise.resolve(this.transport.request('destroy', {})).catch(() => undefined);
        this.transport.destroy();
    }

    /** Throw INSTANCE_DESTROYED if already destroyed. */
    private assertAlive(): void {
        if (this.destroyed) {
            throw makeError(ErrorCode.INSTANCE_DESTROYED, 'Checkout instance has been destroyed', 'runtime');
        }
    }

    /** Mutual-exclusion check: throws ELEMENT_CONFLICT on conflict (derived live from the elements Map, does not mutate the registry). */
    private assertNoConflict(type: ElementType, options?: ElementOptions): void {
        const existing = [...this.elements.values()];
        const has = (t: ElementType): boolean => existing.some((e) => e.type === t);
        const hasCardField = (): boolean => existing.some((e) => CARD_FIELD_TYPES.includes(e.type));

        if (type === 'card') {
            if (has('card')) {
                throw makeError(ErrorCode.ELEMENT_CONFLICT, 'A combined card Element already exists');
            }
            if (hasCardField()) {
                throw makeError(
                    ErrorCode.ELEMENT_CONFLICT,
                    'Combined card and split card fields are mutually exclusive; split card fields already exist'
                );
            }
            return;
        }
        if (CARD_FIELD_TYPES.includes(type)) {
            if (has('card')) {
                throw makeError(
                    ErrorCode.ELEMENT_CONFLICT,
                    'Split card fields and combined card are mutually exclusive; a combined card already exists'
                );
            }
            // The same split field type cannot be duplicated.
            if (has(type)) {
                throw makeError(
                    ErrorCode.ELEMENT_CONFLICT,
                    `A split card field of type ${type} already exists`
                );
            }
            return;
        }
        if (type === 'address') {
            const mode = (options as { mode?: string } | undefined)?.mode;
            if (mode && existing.some((e) => e.type === 'address' && e.mode === mode)) {
                throw makeError(
                    ErrorCode.ELEMENT_CONFLICT,
                    `An address Element with mode=${mode} already exists`
                );
            }
            return;
        }
        if (type === 'expressCheckout') {
            if (has('expressCheckout')) {
                throw makeError(ErrorCode.ELEMENT_CONFLICT, 'An expressCheckout Element already exists');
            }
            return;
        }
    }

    /**
     * Element `destroy()` callback: remove this elementId from the mutual-exclusion registry (the
     * elements Map) to free the slot. Idempotent; when the whole instance is destroyed (destroyed
     * already set) it goes through the unified `elements.clear()` path, so this is a no-op here,
     * avoiding concurrent modification while iterating elements to call element.destroy().
     */
    private releaseElement(elementId: string): void {
        if (this.destroyed) {
            return;
        }
        this.elements.delete(elementId);
    }

    /** Handle the paymentResult event: fulfill the pending confirm by operationId; late/mismatched ones are ignored. */
    private handlePaymentResult(payload: unknown): void {
        if (this.destroyed) {
            return;
        }
        if (typeof payload !== 'object' || payload === null) {
            return;
        }
        const evt = payload as Partial<PaymentResultEvent>;
        const pending = this.pendingConfirm;
        if (!pending) {
            return;
        }
        if (evt.operationId !== pending.operationId) {
            return;
        }
        const outcome = evt.outcome;
        if (!outcome) {
            return;
        }
        if (outcome.status === 'pending') {
            // Non-terminal: keep waiting (and keep the slot) for the final outcome.
            pending.lastPendingTxnId = outcome.txnId ?? pending.lastPendingTxnId;
            return;
        }
        if (
            outcome.status !== 'succeeded' &&
            outcome.status !== 'failed' &&
            outcome.status !== 'canceled'
        ) {
            return;
        }
        // Terminal: free the slot; settle the Promise unless the watchdog/timeout already did.
        this.pendingConfirm = null;
        this.clearWatchdog(pending);
        if (!pending.settled) {
            pending.settled = true;
            pending.resolve(outcome);
        }
    }

    /** Clear a pending confirm's watchdog timer (idempotent). */
    private clearWatchdog(entry: PendingConfirm): void {
        if (entry.watchdog !== null) {
            clearTimeout(entry.watchdog);
            entry.watchdog = null;
        }
    }
}
