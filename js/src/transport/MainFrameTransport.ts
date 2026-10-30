/**
 * MainFrameTransport — the transport layer between the merchant SDK and the hosted main iframe (spec 5).
 *
 * Responsibilities:
 * - Create a hidden, 0-size main iframe (`${hostOrigin}/embed/sdk/main?checkoutId=...`).
 * - Send request envelopes and pair responses by `requestId` (resolve/reject).
 * - Dispatch `kind:'event'` envelopes to handlers registered via `on`.
 * - Enforce the security boundary: only accept messages whose `event.origin === hostOrigin`,
 *   whose `event.source` is this transport's own main iframe window, whose envelope `checkoutId`
 *   matches and (after the handshake) whose `runtimeId` matches the negotiated one.
 * - `destroy()` cleans up the iframe/listener and rejects all pending requests with INSTANCE_DESTROYED.
 *
 * Security constraint (AGENTS/spec): envelopes **never contain card values**; this layer only
 * carries protocol envelopes and never touches card data.
 * RuntimeHello (`kind:'hello'`) has no checkoutId yet during the handshake phase, so it is
 * recognized and handled **separately** by this layer rather than passed to `decodeEnvelope`
 * (which requires checkoutId).
 */

import {
    decodeEnvelope,
    encodeEnvelope,
    PROTOCOL_MAJOR,
    PROTOCOL_NAME,
    type CheckoutError,
    type CommandName,
    type Envelope,
    type EventName,
    type RuntimeHello,
} from '@sunbay/checkout-sdk-protocol';
import { ErrorCode } from '@sunbay/checkout-sdk-protocol';
import { runtimeUrl } from '../config/env';
import { isValidRuntimeHello } from './hello';

/** Constructor parameters. */
export interface MainFrameTransportOptions {
    checkoutId: string;
    hostOrigin: string;
}

/** Configurable timeouts (ms). */
export interface RequestTimeoutConfig {
    /** Default timeout for regular commands. */
    default: number;
    /** Timeout for the initialize command. */
    initialize: number;
    /** Handshake (hello) timeout. */
    handshake: number;
}

/** Default timeouts: regular 10s, initialize 30s, handshake 15s. */
export const DEFAULT_REQUEST_TIMEOUTS: RequestTimeoutConfig = {
    default: 10_000,
    initialize: 30_000,
    handshake: 15_000,
};

/**
 * Rethrow an error from a handler asynchronously: the current dispatch loop keeps running, while
 * the error still reaches the host page's console / `window.onerror` instead of being swallowed.
 */
function rethrowAsync(err: unknown): void {
    setTimeout(() => {
        throw err;
    }, 0);
}

/** Event handler signature (payload is of unknown shape, refined by the caller per EventName). */
export type EventHandler = (payload: unknown) => void;

/** Pairing record for a pending request. */
interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (reason: CheckoutError) => void;
    timer: ReturnType<typeof setTimeout>;
}

/** Generate a unique id (requestId / errorId). */
function genId(prefix: string): string {
    const rand = Math.random().toString(36).slice(2);
    return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

/** Construct a structured CheckoutError (runtime category). */
function makeError(code: string, message: string): CheckoutError {
    return {
        code,
        message,
        category: 'runtime',
        errorId: genId('err'),
    };
}

/**
 * Determine whether an unknown object is a RuntimeHello (handshake phase, no checkoutId).
 *
 * Does not rely on decodeEnvelope — hello is not part of the Envelope union.
 */
function isRuntimeHello(value: unknown): value is RuntimeHello {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return record.protocol === PROTOCOL_NAME && record.kind === 'hello';
}

export class MainFrameTransport {
    private readonly checkoutId: string;
    private readonly hostOrigin: string;
    private readonly timeouts: RequestTimeoutConfig;

    private iframe: HTMLIFrameElement | null = null;
    private readonly pending = new Map<string, PendingRequest>();
    private readonly eventHandlers = new Map<EventName, Set<EventHandler>>();
    private helloHandler: ((hello: RuntimeHello) => void) | null = null;
    /**
     * Runtime id negotiated during the handshake; empty string before injection. Outbound request
     * envelopes are filled from it; the main endpoint only processes requests whose runtimeId
     * matches its own, and an empty string is silently dropped.
     */
    private runtimeId = '';

    private readonly messageListener: (event: MessageEvent) => void;
    private destroyed = false;

    constructor(
        options: MainFrameTransportOptions,
        timeouts: RequestTimeoutConfig = DEFAULT_REQUEST_TIMEOUTS
    ) {
        this.checkoutId = options.checkoutId;
        this.hostOrigin = options.hostOrigin;
        this.timeouts = timeouts;
        this.messageListener = (event: MessageEvent): void => {
            this.handleMessage(event);
        };
        window.addEventListener('message', this.messageListener);
    }

    /**
     * Create the hidden, 0-size main iframe and append it to document.body.
     *
     * @returns The mounted iframe element.
     * @example
     * const iframe = transport.createHiddenIframe();
     */
    createHiddenIframe(): HTMLIFrameElement {
        if (this.iframe) {
            return this.iframe;
        }
        const iframe = document.createElement('iframe');
        iframe.src = `${runtimeUrl(this.hostOrigin, 'main')}?checkoutId=${this.checkoutId}`;
        iframe.setAttribute('aria-hidden', 'true');
        iframe.title = 'sunbay-checkout-main';
        iframe.style.position = 'absolute';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.style.visibility = 'hidden';
        document.body.appendChild(iframe);
        this.iframe = iframe;
        return iframe;
    }

    /**
     * Send one request envelope and pair the response by requestId.
     *
     * @param name - Command name.
     * @param payload - Command payload (JSON-serializable).
     * @returns The response data; on failure (ok:false / timeout / destroy) rejects with a CheckoutError.
     * @example
     * const session = await transport.request('getSession', {});
     */
    request(name: CommandName, payload: unknown): Promise<unknown> {
        return new Promise<unknown>((resolve, reject) => {
            if (this.destroyed) {
                reject(makeError(ErrorCode.INSTANCE_DESTROYED, 'Checkout instance has been destroyed'));
                return;
            }
            const contentWindow = this.iframe?.contentWindow;
            if (!contentWindow) {
                reject(
                    makeError(
                        ErrorCode.RUNTIME_LOAD_FAILED,
                        'main iframe not created or contentWindow unavailable'
                    )
                );
                return;
            }

            const requestId = genId('req');
            const envelope: Envelope = {
                protocol: PROTOCOL_NAME,
                major: PROTOCOL_MAJOR,
                runtimeId: this.runtimeId,
                checkoutId: this.checkoutId,
                kind: 'request',
                requestId,
                name,
                payload,
            };

            const timeoutMs = this.resolveTimeout(name);
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(makeError(ErrorCode.REQUEST_TIMEOUT, `Command ${name} timed out`));
            }, timeoutMs);

            this.pending.set(requestId, { resolve, reject, timer });
            contentWindow.postMessage(encodeEnvelope(envelope), this.hostOrigin);
        });
    }

    /**
     * Register an event handler (dispatches the payload of kind:'event' envelopes).
     *
     * @param event - Event name.
     * @param handler - Callback.
     */
    on(event: EventName, handler: EventHandler): void {
        let set = this.eventHandlers.get(event);
        if (!set) {
            set = new Set<EventHandler>();
            this.eventHandlers.set(event, set);
        }
        set.add(handler);
    }

    /**
     * Unregister an event handler.
     *
     * @param event - Event name.
     * @param handler - The previously registered callback.
     */
    off(event: EventName, handler: EventHandler): void {
        const set = this.eventHandlers.get(event);
        if (set) {
            set.delete(handler);
            if (set.size === 0) {
                this.eventHandlers.delete(event);
            }
        }
    }

    /**
     * Register the handshake (RuntimeHello) callback. The hello phase has no checkoutId yet and is
     * handled separately. The callback is one-shot: it is cleared after the first valid hello from
     * this transport's own iframe; malformed hellos are ignored.
     *
     * @param handler - Called when a hello is received.
     */
    onHello(handler: (hello: RuntimeHello) => void): void {
        this.helloHandler = handler;
    }

    /**
     * Inject the runtime id negotiated during the handshake. Must be called before sending the first
     * request (initialize), otherwise the outbound envelope's runtimeId is an empty string, gets
     * silently dropped by the main endpoint, and the request times out.
     *
     * @param runtimeId - The runtimeId from RuntimeHello.
     */
    setRuntimeId(runtimeId: string): void {
        this.runtimeId = runtimeId;
    }

    /**
     * Destroy: remove the iframe, clear listeners, and reject pending requests with INSTANCE_DESTROYED.
     */
    destroy(): void {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        window.removeEventListener('message', this.messageListener);

        for (const [, entry] of this.pending) {
            clearTimeout(entry.timer);
            entry.reject(makeError(ErrorCode.INSTANCE_DESTROYED, 'Checkout instance has been destroyed'));
        }
        this.pending.clear();
        this.eventHandlers.clear();
        this.helloHandler = null;

        if (this.iframe && this.iframe.parentNode) {
            this.iframe.parentNode.removeChild(this.iframe);
        }
        this.iframe = null;
    }

    /** Resolve the timeout by command name. */
    private resolveTimeout(name: CommandName): number {
        if (name === 'initialize') {
            return this.timeouts.initialize;
        }
        return this.timeouts.default;
    }

    /**
     * Point-to-point port relay (parent-window relay, Stripe controller model).
     *
     * Sibling iframes (main and the various Element iframes) cannot obtain each other's window
     * references, so they cannot transfer a MessagePort directly. This layer (the merchant page,
     * the only party that can reach both ends and knows their origin) does the following when it
     * receives an `element-online` from some Element iframe:
     * 1. Create a `MessageChannel`;
     * 2. `port1` → main iframe (`relay-port`, targetOrigin=hostOrigin);
     * 3. `port2` → the originating Element iframe (i.e. `event.source`, targetOrigin=hostOrigin).
     *
     * Both ends' origin is hostOrigin, so targetOrigin is always correct (and not dropped across
     * origins). This layer only carries **empty ports** and never touches card values (which are
     * transmitted end-to-end after the port is established).
     *
     * @param event Inbound message (origin already verified as hostOrigin)
     * @returns Whether it was handled as element-online (if so, the caller should return)
     */
    private tryHandleElementOnline(event: MessageEvent): boolean {
        const data = event.data as unknown;
        if (typeof data !== 'object' || data === null) {
            return false;
        }
        const msg = data as Record<string, unknown>;
        if (msg.kind !== 'element-online') {
            return false;
        }
        // Validate: checkoutId matches, fieldType is valid, source window exists.
        if (msg.checkoutId !== this.checkoutId || typeof msg.fieldType !== 'string') {
            return true;
        }
        const mainWin = this.iframe?.contentWindow;
        const elementWin = event.source as Window | null;
        if (!mainWin || !elementWin) {
            return true;
        }

        const channel = new MessageChannel();
        const relayMsg = {
            kind: 'relay-port' as const,
            checkoutId: this.checkoutId,
            fieldType: msg.fieldType,
        };
        // port1 → main iframe; port2 → the originating Element iframe.
        mainWin.postMessage(relayMsg, this.hostOrigin, [channel.port1]);
        elementWin.postMessage(relayMsg, this.hostOrigin, [channel.port2]);
        return true;
    }

    /** Handle an inbound message: filter origin, recognize relay / hello / Envelope and dispatch. */
    private handleMessage(event: MessageEvent): void {
        if (this.destroyed) {
            return;
        }
        // Security boundary: only accept messages from the hosted page origin.
        if (event.origin !== this.hostOrigin) {
            return;
        }

        // Point-to-point port relay: an Element iframe comes online → this layer (parent window)
        // creates a channel and transfers the two ports to the main iframe and that Element iframe
        // respectively (see below). The relay message is an object (not a string envelope) and must
        // be recognized before the string check.
        if (this.tryHandleElementOnline(event)) {
            return;
        }

        if (typeof event.data !== 'string') {
            return;
        }

        // Security boundary: hello and envelopes must come from this instance's own main iframe
        // window. This keeps concurrent checkout instances (each with its own iframe) from
        // adopting each other's hello/runtimeId, and rejects same-origin lookalike windows.
        const mainWindow = this.iframe?.contentWindow;
        if (!mainWindow || event.source !== mainWindow) {
            return;
        }

        // The handshake hello is parsed separately (not via the Envelope union; no checkoutId at this phase).
        let raw: unknown;
        try {
            raw = JSON.parse(event.data);
        } catch {
            return;
        }
        if (isRuntimeHello(raw)) {
            // A malformed hello is ignored (it neither throws nor consumes the one-shot handler).
            if (!isValidRuntimeHello(raw)) {
                return;
            }
            // One-shot: the first valid hello is consumed; later hellos (e.g. a dev double mount
            // or a reloaded runtime) are ignored so the negotiated runtimeId cannot be swapped.
            const handler = this.helloHandler;
            this.helloHandler = null;
            if (handler) {
                try {
                    handler(raw);
                } catch (err) {
                    rethrowAsync(err);
                }
            }
            return;
        }

        // Everything else is validated and decoded as an Envelope.
        let envelope: Envelope;
        try {
            envelope = decodeEnvelope(event.data);
        } catch {
            return;
        }

        // Security boundary: the envelope checkoutId must match this instance.
        if (envelope.checkoutId !== this.checkoutId) {
            return;
        }

        // Once a runtimeId is negotiated, drop response/event envelopes from any other runtime
        // instance (the runtime stamps every response and event with its own runtimeId).
        if (this.runtimeId !== '' && envelope.runtimeId !== this.runtimeId) {
            return;
        }

        if (envelope.kind === 'response') {
            this.handleResponse(envelope);
        } else if (envelope.kind === 'event') {
            this.handleEvent(envelope);
        }
        // kind:'request' from main → SDK should not occur; ignore.
    }

    /** Dispatch a response to the paired pending request. */
    private handleResponse(envelope: Extract<Envelope, { kind: 'response' }>): void {
        const entry = this.pending.get(envelope.requestId);
        if (!entry) {
            return;
        }
        this.pending.delete(envelope.requestId);
        clearTimeout(entry.timer);
        if (envelope.ok) {
            entry.resolve(envelope.data);
        } else {
            entry.reject(envelope.error);
        }
    }

    /** Dispatch an event to the registered handlers. */
    private handleEvent(envelope: Extract<Envelope, { kind: 'event' }>): void {
        const set = this.eventHandlers.get(envelope.name as EventName);
        if (!set) {
            return;
        }
        // Iterate a snapshot so handlers that call on/off during dispatch cannot affect this pass.
        for (const handler of [...set]) {
            try {
                handler(envelope.payload);
            } catch (err) {
                rethrowAsync(err);
            }
        }
    }
}
