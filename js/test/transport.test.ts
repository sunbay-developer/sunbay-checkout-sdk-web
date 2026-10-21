import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MainFrameTransport } from '../src/transport/MainFrameTransport';
import { ErrorCode, type CheckoutError, type Envelope } from '@sunbay/checkout-sdk-protocol';

/**
 * transport contract tests (source of truth: js/src/transport/MainFrameTransport).
 *
 * Environment: jsdom. Outbound envelopes are captured via a mocked iframe.contentWindow.postMessage,
 * inbound replies are simulated with window.dispatchEvent(new MessageEvent('message', ...)).
 */

const HOST_ORIGIN = 'https://checkout.sunbay-dev.com';
const CHECKOUT_ID = 'co_1';
const RUNTIME_ID = 'rt_1';

/** Captures outbound string envelopes from postMessage. */
let sent: string[];

/**
 * Replace iframe.contentWindow.postMessage to record outbound envelopes.
 * createHiddenIframe truly creates an iframe (contentWindow exists under jsdom).
 */
function patchIframeContentWindow(iframe: HTMLIFrameElement): void {
    const cw = iframe.contentWindow;
    if (!cw) {
        throw new Error('jsdom iframe.contentWindow is null');
    }
    vi.spyOn(cw, 'postMessage').mockImplementation(((message: unknown) => {
        sent.push(message as string);
    }) as typeof cw.postMessage);
}

/** Parse the most recent outbound request envelope. */
function lastRequest(): Extract<Envelope, { kind: 'request' }> {
    const wire = sent[sent.length - 1];
    const env = JSON.parse(wire) as Envelope;
    if (env.kind !== 'request') {
        throw new Error('the most recent outbound envelope is not a request');
    }
    return env;
}

/** Build a successful response envelope string. */
function okResponseWire(requestId: string, data: unknown): string {
    const env: Envelope = {
        protocol: 'sunbay-checkout',
        major: 1,
        runtimeId: RUNTIME_ID,
        checkoutId: CHECKOUT_ID,
        kind: 'response',
        requestId,
        ok: true,
        data,
    };
    return JSON.stringify(env);
}

/** Build a failed response envelope string. */
function errResponseWire(requestId: string, error: CheckoutError): string {
    const env: Envelope = {
        protocol: 'sunbay-checkout',
        major: 1,
        runtimeId: RUNTIME_ID,
        checkoutId: CHECKOUT_ID,
        kind: 'response',
        requestId,
        ok: false,
        error,
    };
    return JSON.stringify(env);
}

/** Build an event envelope string. */
function eventWire(name: string, payload: unknown, checkoutId = CHECKOUT_ID): string {
    const env: Envelope = {
        protocol: 'sunbay-checkout',
        major: 1,
        runtimeId: RUNTIME_ID,
        checkoutId,
        kind: 'event',
        eventId: 'evt_' + Math.random().toString(36).slice(2),
        name,
        payload,
    };
    return JSON.stringify(env);
}

/** Simulate delivering a message to window from the hosted page. */
function deliver(data: string, origin = HOST_ORIGIN): void {
    window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

describe('MainFrameTransport', () => {
    let transport: MainFrameTransport;

    beforeEach(() => {
        sent = [];
        transport = new MainFrameTransport({
            checkoutId: CHECKOUT_ID,
            hostOrigin: HOST_ORIGIN,
        });
        const iframe = transport.createHiddenIframe();
        patchIframeContentWindow(iframe);
    });

    afterEach(() => {
        transport.destroy();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('createHiddenIframe creates a hidden zero-size iframe attached to body, src carries checkoutId', () => {
        const iframe = document.body.querySelector('iframe');
        expect(iframe).not.toBeNull();
        expect(iframe!.src).toBe(`${HOST_ORIGIN}/sdk/main?checkoutId=${CHECKOUT_ID}`);
    });

    it('request sends a request envelope: contains name/payload/requestId, postMessage to iframe', () => {
        // This case only checks the outbound envelope and does not await a response; attach a catch
        // to swallow the INSTANCE_DESTROYED reject from afterEach destroy(), avoiding unhandled
        // rejection.
        transport.request('getSession', {}).catch(() => undefined);
        const req = lastRequest();
        expect(req.name).toBe('getSession');
        expect(req.checkoutId).toBe(CHECKOUT_ID);
        expect(typeof req.requestId).toBe('string');
        expect(req.requestId.length).toBeGreaterThan(0);
    });

    it('outbound request envelope runtimeId is an empty string when runtimeId is not injected', () => {
        transport.request('getSession', {}).catch(() => undefined);
        expect(lastRequest().runtimeId).toBe('');
    });

    it('outbound request envelope carries the negotiated runtimeId after setRuntimeId', () => {
        // Regression: not backfilling the runtimeId handshake causes the main endpoint to silently
        // drop requests → initialize times out.
        transport.setRuntimeId(RUNTIME_ID);
        transport.request('initialize', { sessionId: 'sess_1' }).catch(() => undefined);
        expect(lastRequest().runtimeId).toBe(RUNTIME_ID);
    });

    it('response ok resolves the Promise and returns data', async () => {
        const p = transport.request('getSession', {});
        const req = lastRequest();
        deliver(okResponseWire(req.requestId, { sessionId: 'sess_1' }));
        await expect(p).resolves.toEqual({ sessionId: 'sess_1' });
    });

    it('response ok:false rejects it with a CheckoutError', async () => {
        const p = transport.request('confirm', { operationId: 'op_1' });
        const req = lastRequest();
        const error: CheckoutError = {
            code: ErrorCode.CHECKOUT_BUSY,
            message: 'busy',
            category: 'runtime',
            errorId: 'err_1',
        };
        deliver(errResponseWire(req.requestId, error));
        await expect(p).rejects.toMatchObject({ code: ErrorCode.CHECKOUT_BUSY });
    });

    it('timeout rejects REQUEST_TIMEOUT (normal command 10s)', async () => {
        vi.useFakeTimers();
        const p = transport.request('getSession', {});
        const assertion = expect(p).rejects.toMatchObject({
            code: ErrorCode.REQUEST_TIMEOUT,
        });
        await vi.advanceTimersByTimeAsync(10_000);
        await assertion;
    });

    it('initialize default timeout 30s (not triggered at 10s, triggered at 30s)', async () => {
        vi.useFakeTimers();
        const p = transport.request('initialize', { sessionId: 'sess_1' });
        const assertion = expect(p).rejects.toMatchObject({
            code: ErrorCode.REQUEST_TIMEOUT,
        });
        // Still pending at 10s (no unhandled rejection)
        await vi.advanceTimersByTimeAsync(10_000);
        await vi.advanceTimersByTimeAsync(20_000);
        await assertion;
    });

    it('message with wrong origin is ignored (request does not resolve)', async () => {
        vi.useFakeTimers();
        const p = transport.request('getSession', {});
        const req = lastRequest();
        deliver(okResponseWire(req.requestId, { sessionId: 'sess_1' }), 'https://evil.example');
        // Wrong origin is dropped → eventually times out and rejects
        const assertion = expect(p).rejects.toMatchObject({
            code: ErrorCode.REQUEST_TIMEOUT,
        });
        await vi.advanceTimersByTimeAsync(10_000);
        await assertion;
    });

    it('message with mismatched checkoutId is ignored', async () => {
        vi.useFakeTimers();
        const p = transport.request('getSession', {});
        const req = lastRequest();
        const wrong: Envelope = {
            protocol: 'sunbay-checkout',
            major: 1,
            runtimeId: RUNTIME_ID,
            checkoutId: 'co_OTHER',
            kind: 'response',
            requestId: req.requestId,
            ok: true,
            data: { sessionId: 'x' },
        };
        deliver(JSON.stringify(wrong));
        const assertion = expect(p).rejects.toMatchObject({
            code: ErrorCode.REQUEST_TIMEOUT,
        });
        await vi.advanceTimersByTimeAsync(10_000);
        await assertion;
    });

    it('pending request rejects INSTANCE_DESTROYED after destroy()', async () => {
        const p = transport.request('getSession', {});
        const assertion = expect(p).rejects.toMatchObject({
            code: ErrorCode.INSTANCE_DESTROYED,
        });
        transport.destroy();
        await assertion;
    });

    it('a late ok response with the same requestId after destroy() is ignored, terminal state stays rejected(INSTANCE_DESTROYED)', async () => {
        // Regression: Review Focus "late messages after destroy are ignored".
        // First .catch to prevent unhandled rejection; record the terminal state to assert it is
        // never tampered to resolve.
        const p = transport.request('getSession', {});
        const req = lastRequest();

        let settled: 'resolved' | 'rejected' | 'pending' = 'pending';
        let settledReason: unknown;
        const observed = p.then(
            (value) => {
                settled = 'resolved';
                settledReason = value;
            },
            (reason) => {
                settled = 'rejected';
                settledReason = reason;
            }
        );

        // destroy() → Promise rejects with INSTANCE_DESTROYED.
        transport.destroy();
        await observed;
        expect(settled).toBe('rejected');
        expect(settledReason).toMatchObject({ code: ErrorCode.INSTANCE_DESTROYED });

        // Late: deliver an ok response envelope with the same requestId.
        // destroyed guard + pending already cleared → should not throw, nor produce an extra resolve.
        expect(() => deliver(okResponseWire(req.requestId, { sessionId: 'late' }))).not.toThrow();

        // Let the microtask queue advance fully to ensure no late settle changes the terminal state.
        await Promise.resolve();
        await Promise.resolve();

        // Terminal state unchanged: still rejected(INSTANCE_DESTROYED), never tampered to resolve.
        expect(settled).toBe('rejected');
        expect(settledReason).toMatchObject({ code: ErrorCode.INSTANCE_DESTROYED });
        await expect(p).rejects.toMatchObject({ code: ErrorCode.INSTANCE_DESTROYED });
    });

    it('destroy() removes the iframe', () => {
        expect(document.body.querySelector('iframe')).not.toBeNull();
        transport.destroy();
        expect(document.body.querySelector('iframe')).toBeNull();
    });

    it('on-registered event handler receives the payload of a kind:event envelope', () => {
        const handler = vi.fn();
        transport.on('ready', handler);
        deliver(eventWire('ready', { elementId: 'el_1' }));
        expect(handler).toHaveBeenCalledWith({ elementId: 'el_1' });
    });

    it('no longer receives events after off deregisters', () => {
        const handler = vi.fn();
        transport.on('change', handler);
        transport.off('change', handler);
        deliver(eventWire('change', { elementId: 'el_1', empty: true, complete: false }));
        expect(handler).not.toHaveBeenCalled();
    });

    it('does not dispatch when event checkoutId does not match', () => {
        const handler = vi.fn();
        transport.on('ready', handler);
        deliver(eventWire('ready', { elementId: 'el_1' }, 'co_OTHER'));
        expect(handler).not.toHaveBeenCalled();
    });

    it('relay: on element-online → transfer one port to each of main and the source Element iframe', () => {
        // Capture the record of each postMessage call (including the transfer argument).
        interface PostCall {
            msg: unknown;
            origin: string | undefined;
            ports: readonly MessagePort[] | undefined;
        }
        // main iframe's postMessage records. beforeEach already called createHiddenIframe.
        const mainWin = transport.createHiddenIframe().contentWindow as Window;
        const mainCalls: PostCall[] = [];
        vi.spyOn(mainWin, 'postMessage').mockImplementation(((
            msg: unknown,
            origin?: string,
            ports?: readonly MessagePort[]
        ) => {
            mainCalls.push({ msg, origin, ports });
        }) as unknown as typeof mainWin.postMessage);

        // Simulate the Element iframe window (event.source) that initiates element-online.
        const elementCalls: PostCall[] = [];
        const elementWin = {
            postMessage: (msg: unknown, origin?: string, ports?: readonly MessagePort[]) => {
                elementCalls.push({ msg, origin, ports });
            },
        } as unknown as Window;

        window.dispatchEvent(
            new MessageEvent('message', {
                data: { kind: 'element-online', checkoutId: CHECKOUT_ID, fieldType: 'cardNumber' },
                origin: HOST_ORIGIN,
                source: elementWin,
            })
        );

        // main side receives relay-port + 1 port, targetOrigin=hostOrigin.
        expect(mainCalls).toHaveLength(1);
        expect(mainCalls[0].msg).toMatchObject({
            kind: 'relay-port',
            checkoutId: CHECKOUT_ID,
            fieldType: 'cardNumber',
        });
        expect(mainCalls[0].origin).toBe(HOST_ORIGIN);
        expect(mainCalls[0].ports).toHaveLength(1);

        // Element iframe side also receives relay-port + 1 port.
        expect(elementCalls).toHaveLength(1);
        expect(elementCalls[0].msg).toMatchObject({ fieldType: 'cardNumber' });
        expect(elementCalls[0].origin).toBe(HOST_ORIGIN);
        expect(elementCalls[0].ports).toHaveLength(1);

        // main and Element get two different ports of the same channel.
        expect(mainCalls[0].ports?.[0]).not.toBe(elementCalls[0].ports?.[0]);
    });

    it('relay: element-online with mismatched checkoutId does not dispatch a port', () => {
        const mainWin = transport.createHiddenIframe().contentWindow as Window;
        const spy = vi
            .spyOn(mainWin, 'postMessage')
            .mockImplementation((() => undefined) as unknown as typeof mainWin.postMessage);
        const elementPost = vi.fn();
        const elementWin = { postMessage: elementPost } as unknown as Window;
        window.dispatchEvent(
            new MessageEvent('message', {
                data: { kind: 'element-online', checkoutId: 'co_OTHER', fieldType: 'cardNumber' },
                origin: HOST_ORIGIN,
                source: elementWin,
            })
        );
        expect(spy).not.toHaveBeenCalled();
        expect(elementPost).not.toHaveBeenCalled();
    });
});
