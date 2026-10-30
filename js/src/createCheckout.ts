/**
 * createCheckout — the merchant SDK's single async entry (spec 4).
 *
 * Flow:
 * 1. Generate `checkoutId`, derive the hosted origin via `resolveHostOrigin(env, hostOrigin)`.
 * 2. Build the transport, `createHiddenIframe()` to load the hosted main iframe.
 * 3. Register onHello; wait for RuntimeHello (timeout 15s → reject RUNTIME_LOAD_FAILED).
 * 4. Pick a common major version (no intersection → reject PROTOCOL_UNSUPPORTED).
 * 5. Send `initialize` (sessionId/locale/appearance/paymentMethods) to obtain
 *    capabilities + PublicSessionView; any step failing rejects and destroys the transport.
 * 6. Inject the handshake runtimeId into the transport, construct and resolve {@link CheckoutInstance}.
 *
 * Security constraint (AGENTS/spec): this layer only orchestrates handshake/initialization and
 * **never touches card values**.
 */

import { MainFrameTransport } from './transport/MainFrameTransport';
import { CheckoutInstance, type InstanceTransport } from './CheckoutInstance';
import { isValidRuntimeHello } from './transport/hello';
import { resolveHostOrigin, type Env } from './config/env';
import {
    ErrorCode,
    PROTOCOL_MAJOR,
    type Appearance,
    type CheckoutError,
    type InitializeReq,
    type InitializeResp,
    type PaymentMethodFilter,
    type RuntimeHello,
} from '@sunbay/checkout-sdk-protocol';

/** Handshake timeout (ms): matches the transport handshake timeout (15s). */
const HANDSHAKE_TIMEOUT_MS = 15_000;

/**
 * Internal transport factory injectable when creating a CheckoutInstance (test/advanced use only).
 *
 * Real scenarios use the built-in MainFrameTransport; tests may inject a mock to drive hello/events.
 */
export type TransportFactory = (args: {
    checkoutId: string;
    hostOrigin: string;
}) => InstanceTransport;

/** createCheckout parameters. */
export interface CreateCheckoutOptions {
    /** Checkout session id created by the backend (required). */
    sessionId: string;
    /** Runtime environment (dev/test/prod), defaults to prod. */
    env?: Env;
    /** Override the hosted origin (takes precedence over env). */
    hostOrigin?: string;
    /** Locale. */
    locale?: string;
    /** Appearance customization. */
    appearance?: Appearance;
    /** Payment method filter (subtractive/reordering only). */
    paymentMethods?: PaymentMethodFilter;
    /** Internal injection point: custom transport factory (test use; not part of the public API contract). */
    __transportFactory?: TransportFactory;
}

/** Generate a unique id. */
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

/** Default transport factory: the built-in MainFrameTransport. */
const defaultTransportFactory: TransportFactory = ({ checkoutId, hostOrigin }) =>
    new MainFrameTransport({ checkoutId, hostOrigin });

/**
 * Create a checkout instance: resolves after a successful handshake + initialization.
 *
 * @param opts - Checkout parameters.
 * @returns A ready CheckoutInstance.
 * @throws reject RUNTIME_LOAD_FAILED (handshake timeout) / PROTOCOL_UNSUPPORTED (no common major
 *         version) / or the initialize business error.
 * @example
 * const checkout = await createCheckout({ sessionId: 'sess_x', env: 'prod' });
 */
export async function createCheckout(opts: CreateCheckoutOptions): Promise<CheckoutInstance> {
    const checkoutId = genId('co');
    const hostOrigin = resolveHostOrigin(opts.env, opts.hostOrigin);
    const factory = opts.__transportFactory ?? defaultTransportFactory;
    const transport = factory({ checkoutId, hostOrigin });

    // Start the hosted main iframe (hidden, 0 size).
    transport.createHiddenIframe();

    let hello: RuntimeHello;
    try {
        hello = await waitForHello(transport);
    } catch (err) {
        transport.destroy();
        throw err;
    }

    // Pick a common major version.
    if (!hello.supportedMajorVersions.includes(PROTOCOL_MAJOR)) {
        transport.destroy();
        throw makeError(
            ErrorCode.PROTOCOL_UNSUPPORTED,
            `No common major protocol version: SDK=${PROTOCOL_MAJOR}, runtime=${JSON.stringify(hello.supportedMajorVersions)}`
        );
    }

    // Inject the negotiated runtimeId: must happen before sending initialize, otherwise the
    // outbound envelope's runtimeId is an empty string, gets silently dropped by the main
    // endpoint, and causes initialize to time out.
    transport.setRuntimeId(hello.runtimeId);

    // Send initialize.
    const initReq: InitializeReq = {
        sessionId: opts.sessionId,
        locale: opts.locale,
        appearance: opts.appearance,
        paymentMethods: opts.paymentMethods,
    };
    let initResp: InitializeResp;
    try {
        initResp = (await transport.request('initialize', initReq)) as InitializeResp;
    } catch (err) {
        transport.destroy();
        throw err as CheckoutError;
    }

    return new CheckoutInstance({
        checkoutId,
        runtimeId: hello.runtimeId,
        hostOrigin,
        transport,
        capabilities: initResp.capabilities,
        session: initResp.session,
        appearance: opts.appearance,
    });
}

/** Wait for RuntimeHello; reject RUNTIME_LOAD_FAILED on timeout. */
function waitForHello(transport: InstanceTransport): Promise<RuntimeHello> {
    return new Promise<RuntimeHello>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) {
                return;
            }
            settled = true;
            reject(makeError(ErrorCode.RUNTIME_LOAD_FAILED, 'Timed out waiting for hosted runtime handshake'));
        }, HANDSHAKE_TIMEOUT_MS);

        transport.onHello((raw: unknown) => {
            if (settled || !isValidRuntimeHello(raw)) {
                // Malformed hello: ignore and keep waiting (the handshake timeout still applies).
                return;
            }
            settled = true;
            clearTimeout(timer);
            resolve(raw);
        });
    });
}
