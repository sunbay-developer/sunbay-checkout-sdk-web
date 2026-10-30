import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MainFrameTransport } from '../src/transport/MainFrameTransport';
import { CheckoutInstance, type InstanceTransport } from '../src/CheckoutInstance';
import { CheckoutElement } from '../src/Element';
import { createCheckout } from '../src/createCheckout';
import {
    ErrorCode,
    type CheckoutError,
    type CommandName,
    type Envelope,
    type PaymentOutcome,
    type PublicSessionView,
    type InitializeResp,
} from '@sunbay/checkout-sdk-protocol';

/**
 * Lifecycle hardening tests: confirm pending/watchdog/timeout semantics, mount timeout and
 * cancellation, and handshake source/shape/runtimeId filtering. Fake timers are used throughout.
 */

const HOST_ORIGIN = 'https://checkout.sunbay-dev.com';

// ---------------------------------------------------------------------------
// confirm
// ---------------------------------------------------------------------------

interface MockTransport extends InstanceTransport {
    requests: { name: CommandName; payload: unknown }[];
    requestImpl: (name: CommandName, payload: unknown) => Promise<unknown>;
    emit: (event: string, payload: unknown) => void;
}

function createMockTransport(): MockTransport {
    const handlers = new Map<string, Set<(payload: unknown) => void>>();
    return {
        requests: [],
        requestImpl: () => Promise.resolve({ accepted: true }),
        request(name, payload): Promise<unknown> {
            this.requests.push({ name, payload });
            return this.requestImpl(name, payload);
        },
        on(event, handler): void {
            let set = handlers.get(event);
            if (!set) {
                set = new Set();
                handlers.set(event, set);
            }
            set.add(handler);
        },
        off(event, handler): void {
            handlers.get(event)?.delete(handler);
        },
        onHello(): void {},
        setRuntimeId(): void {},
        createHiddenIframe(): void {},
        destroy(): void {},
        emit(event, payload): void {
            for (const h of [...(handlers.get(event) ?? [])]) {
                h(payload);
            }
        },
    };
}

function makeSession(): PublicSessionView {
    return {
        sessionId: 'sess_1',
        sessionType: 'payment',
        currency: 'USD',
        totalAmount: 1000,
        productList: [],
        taxAmount: 0,
        productAmount: 1000,
        description: 'test',
        expiresAt: '2099-01-01T00:00:00Z',
        collectBillingAddress: false,
        collectShippingAddress: false,
        paymentMethods: [],
        merchantName: 'Acme',
        merchantLogoUrl: '',
    };
}

function makeInstance(transport: MockTransport): CheckoutInstance {
    return new CheckoutInstance({
        checkoutId: 'co_1',
        runtimeId: 'rt_1',
        hostOrigin: HOST_ORIGIN,
        transport,
        capabilities: ['card'],
        session: makeSession(),
    });
}

function opIdOf(transport: MockTransport): string {
    const req = transport.requests.find((r) => r.name === 'confirm');
    return (req?.payload as { operationId: string }).operationId;
}

function emitResult(transport: MockTransport, operationId: string, outcome: PaymentOutcome): void {
    transport.emit('paymentResult', { operationId, method: 'card', outcome });
}

/** Track settlement of a promise without awaiting it. */
function track<T>(p: Promise<T>): { state: 'pending' | 'resolved' | 'rejected'; value?: unknown } {
    const box: { state: 'pending' | 'resolved' | 'rejected'; value?: unknown } = {
        state: 'pending',
    };
    p.then(
        (v) => {
            box.state = 'resolved';
            box.value = v;
        },
        (e: unknown) => {
            box.state = 'rejected';
            box.value = e;
        }
    );
    return box;
}

describe('CheckoutInstance.confirm lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('confirm stays pending on pending outcome and resolves on later terminal', async () => {
        const transport = createMockTransport();
        const instance = makeInstance(transport);
        const box = track(instance.confirm());
        await vi.advanceTimersByTimeAsync(0);
        const operationId = opIdOf(transport);

        emitResult(transport, operationId, { status: 'pending', operationId, txnId: 'txn_1' });
        await vi.advanceTimersByTimeAsync(0);
        expect(box.state).toBe('pending');
        // The slot is still occupied while pending.
        await expect(instance.confirm()).rejects.toMatchObject({ code: ErrorCode.CHECKOUT_BUSY });

        const terminal: PaymentOutcome = { status: 'succeeded', operationId, txnId: 'txn_1' };
        emitResult(transport, operationId, terminal);
        await vi.advanceTimersByTimeAsync(0);
        expect(box.state).toBe('resolved');
        expect(box.value).toEqual(terminal);
        // Slot freed after terminal.
        const next = instance.confirm();
        next.catch(() => undefined);
        await expect(Promise.race([next, Promise.resolve('queued')])).resolves.toBe('queued');
        expect(transport.requests.filter((r) => r.name === 'confirm')).toHaveLength(2);
    });

    it('confirm resolves on failed and canceled terminal outcomes', async () => {
        const transport = createMockTransport();
        const instance = makeInstance(transport);
        const p = instance.confirm();
        await vi.advanceTimersByTimeAsync(0);
        const operationId = opIdOf(transport);
        emitResult(transport, operationId, { status: 'canceled', operationId });
        await expect(p).resolves.toEqual({ status: 'canceled', operationId });
    });

    it('confirm watchdog resolves pending without failing and keeps the slot held', async () => {
        const transport = createMockTransport();
        const instance = makeInstance(transport);
        const box = track(instance.confirm({ resultTimeoutMs: 5000 }));
        await vi.advanceTimersByTimeAsync(0);
        const operationId = opIdOf(transport);
        emitResult(transport, operationId, { status: 'pending', operationId, txnId: 'txn_9' });

        await vi.advanceTimersByTimeAsync(4999);
        expect(box.state).toBe('pending');
        await vi.advanceTimersByTimeAsync(1);
        expect(box.state).toBe('resolved');
        expect(box.value).toEqual({ status: 'pending', operationId, txnId: 'txn_9' });

        // The slot stays held to prevent a duplicate submit while the state is unknown.
        await expect(instance.confirm()).rejects.toMatchObject({ code: ErrorCode.CHECKOUT_BUSY });

        // A later terminal result frees the slot.
        emitResult(transport, operationId, { status: 'succeeded', operationId, txnId: 'txn_9' });
        const next = instance.confirm();
        next.catch(() => undefined);
        await vi.advanceTimersByTimeAsync(0);
        expect(transport.requests.filter((r) => r.name === 'confirm')).toHaveLength(2);
    });

    it('confirm watchdog defaults to 120000ms', async () => {
        const transport = createMockTransport();
        const instance = makeInstance(transport);
        const box = track(instance.confirm());
        await vi.advanceTimersByTimeAsync(119_999);
        expect(box.state).toBe('pending');
        await vi.advanceTimersByTimeAsync(1);
        expect(box.state).toBe('resolved');
        expect(box.value).toMatchObject({ status: 'pending' });
    });

    it('confirm timeout rejects with paymentStateKnown=false and blocks duplicate confirm until terminal result', async () => {
        const transport = createMockTransport();
        const timeoutErr: CheckoutError = {
            code: ErrorCode.REQUEST_TIMEOUT,
            message: 'Command confirm timed out',
            category: 'runtime',
            errorId: 'err_1',
        };
        transport.requestImpl = () => Promise.reject(timeoutErr);
        const instance = makeInstance(transport);
        const box = track(instance.confirm());
        await vi.advanceTimersByTimeAsync(0);
        expect(box.state).toBe('rejected');
        expect(box.value).toMatchObject({
            code: ErrorCode.REQUEST_TIMEOUT,
            paymentStateKnown: false,
        });
        await expect(instance.confirm()).rejects.toMatchObject({ code: ErrorCode.CHECKOUT_BUSY });

        const operationId = opIdOf(transport);
        emitResult(transport, operationId, { status: 'failed', operationId, error: timeoutErr });
        transport.requestImpl = () => Promise.resolve({ accepted: true });
        const next = instance.confirm();
        next.catch(() => undefined);
        await vi.advanceTimersByTimeAsync(0);
        expect(transport.requests.filter((r) => r.name === 'confirm')).toHaveLength(2);
    });

    it('confirm command rejected by the runtime frees the slot', async () => {
        const transport = createMockTransport();
        const runtimeErr: CheckoutError = {
            code: ErrorCode.INVALID_OPTIONS,
            message: 'bad',
            category: 'configuration',
            errorId: 'err_2',
        };
        transport.requestImpl = () => Promise.reject(runtimeErr);
        const instance = makeInstance(transport);
        await expect(instance.confirm()).rejects.toMatchObject({ code: ErrorCode.INVALID_OPTIONS });
        transport.requestImpl = () => Promise.resolve({ accepted: true });
        const next = instance.confirm();
        next.catch(() => undefined);
        await vi.advanceTimersByTimeAsync(0);
        expect(transport.requests.filter((r) => r.name === 'confirm')).toHaveLength(2);
    });

    it('onOperation is called before the command is sent', async () => {
        const transport = createMockTransport();
        const instance = makeInstance(transport);
        const seen: { id: string; requestsAtCall: number }[] = [];
        const p = instance.confirm({
            onOperation: (id) => seen.push({ id, requestsAtCall: transport.requests.length }),
        });
        p.catch(() => undefined);
        expect(seen).toHaveLength(1);
        expect(seen[0].requestsAtCall).toBe(0);
        await vi.advanceTimersByTimeAsync(0);
        expect(opIdOf(transport)).toBe(seen[0].id);
        // Merchant-only options are never forwarded to the runtime.
        const payload = transport.requests[0].payload as Record<string, unknown>;
        expect(payload).not.toHaveProperty('onOperation');
        expect(payload).not.toHaveProperty('resultTimeoutMs');
    });

    it('error events with paymentStateKnown=false do not settle confirm', async () => {
        const transport = createMockTransport();
        const instance = makeInstance(transport);
        const box = track(instance.confirm());
        await vi.advanceTimersByTimeAsync(0);
        const operationId = opIdOf(transport);
        transport.emit('error', {
            operationId,
            method: 'card',
            stage: 'poll',
            error: {
                code: 'X',
                message: 'm',
                category: 'network',
                errorId: 'e',
                paymentStateKnown: false,
            },
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(box.state).toBe('pending');
    });

    it('destroy rejects an unsettled confirm and clears the watchdog', async () => {
        const transport = createMockTransport();
        const instance = makeInstance(transport);
        const box = track(instance.confirm());
        await vi.advanceTimersByTimeAsync(0);
        instance.destroy();
        await vi.advanceTimersByTimeAsync(0);
        expect(box.state).toBe('rejected');
        expect(box.value).toMatchObject({ code: ErrorCode.INSTANCE_DESTROYED });
        expect(vi.getTimerCount()).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// mount
// ---------------------------------------------------------------------------

function makeElement(transport: MockTransport, id = 'el_1'): CheckoutElement {
    return new CheckoutElement({
        elementId: id,
        type: 'card',
        hostOrigin: HOST_ORIGIN,
        checkoutId: 'co_1',
        transport,
    });
}

function makeContainer(): HTMLElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

describe('CheckoutElement.mount lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('mount rejects on timeout and removes iframe', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport);
        const container = makeContainer();
        const box = track(el.mount(container));
        expect(container.querySelector('iframe')).not.toBeNull();
        await vi.advanceTimersByTimeAsync(29_999);
        expect(box.state).toBe('pending');
        await vi.advanceTimersByTimeAsync(1);
        expect(box.state).toBe('rejected');
        expect(box.value).toMatchObject({ code: ErrorCode.RUNTIME_LOAD_FAILED });
        expect(container.querySelector('iframe')).toBeNull();
        expect(el.getStatus()).toBe('loadError');
        // Late ready after timeout does not flip the status.
        transport.emit('elementReady', { elementId: 'el_1' });
        expect(el.getStatus()).toBe('loadError');
    });

    it('mount timeout sends destroyElement and a retry mount issues a new createElement', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport);
        const box = track(el.mount(makeContainer()));
        await vi.advanceTimersByTimeAsync(30_000);
        expect(box.state).toBe('rejected');
        expect(transport.requests.map((r) => r.name)).toEqual(['createElement', 'destroyElement']);
        expect(transport.requests[1].payload).toEqual({ elementId: 'el_1' });

        const retry = el.mount(makeContainer());
        await vi.advanceTimersByTimeAsync(0);
        expect(transport.requests.map((r) => r.name)).toEqual([
            'createElement',
            'destroyElement',
            'createElement',
        ]);
        transport.emit('elementReady', { elementId: 'el_1' });
        await retry;
        expect(el.getStatus()).toBe('ready');
    });

    it('no destroyElement when createElement itself failed', async () => {
        const transport = createMockTransport();
        transport.requestImpl = () => Promise.reject({ code: ErrorCode.ELEMENT_CONFLICT });
        const el = makeElement(transport);
        const box = track(el.mount(makeContainer()));
        await vi.advanceTimersByTimeAsync(30_000);
        expect(box.state).toBe('rejected');
        expect(transport.requests.map((r) => r.name)).toEqual(['createElement']);
    });

    it('runtime loadError after a successful createElement sends destroyElement', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport);
        const box = track(el.mount(makeContainer()));
        await vi.advanceTimersByTimeAsync(0);
        transport.emit('loadError', {
            elementId: 'el_1',
            error: { code: ErrorCode.RUNTIME_LOAD_FAILED, message: 'x' },
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(box.state).toBe('rejected');
        expect(transport.requests.map((r) => r.name)).toEqual(['createElement', 'destroyElement']);
    });

    it('mount honors a custom timeoutMs', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport);
        const box = track(el.mount(makeContainer(), { timeoutMs: 1000 }));
        await vi.advanceTimersByTimeAsync(1000);
        expect(box.state).toBe('rejected');
    });

    it('mount clears its timer once ready', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport);
        const p = el.mount(makeContainer());
        transport.emit('elementReady', { elementId: 'el_1' });
        await p;
        expect(vi.getTimerCount()).toBe(0);
        expect(el.getStatus()).toBe('ready');
    });

    it('mount rejects when unmounted while loading and late ready is ignored', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport);
        const container = makeContainer();
        const box = track(el.mount(container));
        const un = el.unmount();
        await un;
        expect(box.state).toBe('rejected');
        expect(box.value).toMatchObject({ code: ErrorCode.RUNTIME_LOAD_FAILED });
        expect(container.querySelector('iframe')).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
        transport.emit('elementReady', { elementId: 'el_1' });
        expect(el.getStatus()).toBe('created');
    });

    it('mount rejects with INSTANCE_DESTROYED when destroyed while loading', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport);
        const box = track(el.mount(makeContainer()));
        el.destroy();
        await vi.advanceTimersByTimeAsync(0);
        expect(box.state).toBe('rejected');
        expect(box.value).toMatchObject({ code: ErrorCode.INSTANCE_DESTROYED });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('destroy sends destroyElement', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport);
        const p = el.mount(makeContainer());
        transport.emit('elementReady', { elementId: 'el_1' });
        await p;
        transport.requestImpl = () => Promise.reject(new Error('boom'));
        el.destroy();
        await vi.advanceTimersByTimeAsync(0);
        expect(transport.requests.some((r) => r.name === 'destroyElement')).toBe(true);
    });

    it('destroy of a never-mounted element does not send destroyElement', () => {
        const transport = createMockTransport();
        const el = makeElement(transport);
        el.destroy();
        expect(transport.requests.some((r) => r.name === 'destroyElement')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// handshake / transport
// ---------------------------------------------------------------------------

function helloWire(runtimeId: unknown = 'rt_1', extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
        protocol: 'sunbay-checkout',
        kind: 'hello',
        runtimeId,
        supportedMajorVersions: [1],
        capabilities: ['card'],
        ...extra,
    });
}

function post(data: string, source: MessageEventSource | null, origin = HOST_ORIGIN): void {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
}

describe('MainFrameTransport handshake hardening', () => {
    const transports: MainFrameTransport[] = [];
    function make(checkoutId: string): { t: MainFrameTransport; win: Window } {
        const t = new MainFrameTransport({ checkoutId, hostOrigin: HOST_ORIGIN });
        transports.push(t);
        const iframe = t.createHiddenIframe();
        const win = iframe.contentWindow;
        if (!win) {
            throw new Error('no contentWindow');
        }
        return { t, win };
    }
    afterEach(() => {
        for (const t of transports.splice(0)) {
            t.destroy();
        }
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('hello from a foreign window is ignored', () => {
        const { t } = make('co_1');
        const spy = vi.fn();
        t.onHello(spy);
        post(helloWire(), window);
        post(helloWire(), null);
        expect(spy).not.toHaveBeenCalled();
    });

    it('hello from the own iframe is accepted once; further hellos are ignored', () => {
        const { t, win } = make('co_1');
        const spy = vi.fn();
        t.onHello(spy);
        post(helloWire('rt_a'), win);
        post(helloWire('rt_b'), win);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0]).toMatchObject({ runtimeId: 'rt_a' });
    });

    it('malformed hello is ignored without throwing', () => {
        const { t, win } = make('co_1');
        const spy = vi.fn();
        t.onHello(spy);
        const bad = [
            helloWire(''),
            helloWire(42),
            helloWire('rt', { supportedMajorVersions: 'x' }),
            helloWire('rt', { supportedMajorVersions: ['1'] }),
            helloWire('rt', { capabilities: [1] }),
            helloWire('rt', { supportedMajorVersions: undefined }),
        ];
        for (const b of bad) {
            expect(() => post(b, win)).not.toThrow();
        }
        expect(spy).not.toHaveBeenCalled();
        // A valid hello afterwards is still consumed.
        post(helloWire('rt_ok'), win);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('envelope from a foreign window is ignored', () => {
        const { t, win } = make('co_1');
        t.setRuntimeId('rt_1');
        const spy = vi.fn();
        t.on('ready', spy);
        const wire = eventWire('ready', 'co_1', 'rt_1');
        post(wire, window);
        expect(spy).not.toHaveBeenCalled();
        post(wire, win);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('inbound envelope with stale runtimeId is dropped', () => {
        const { t, win } = make('co_1');
        t.setRuntimeId('rt_1');
        const spy = vi.fn();
        t.on('ready', spy);
        post(eventWire('ready', 'co_1', 'rt_OLD'), win);
        expect(spy).not.toHaveBeenCalled();
        post(eventWire('ready', 'co_1', 'rt_1'), win);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('stale-runtimeId response does not settle a pending request', async () => {
        vi.useFakeTimers();
        const { t, win } = make('co_1');
        vi.spyOn(win, 'postMessage').mockImplementation(() => undefined);
        t.setRuntimeId('rt_1');
        const box = track(t.request('getSession', {}));
        const sentCall = (win.postMessage as unknown as { mock: { calls: unknown[][] } }).mock
            .calls[0][0] as string;
        const req = JSON.parse(sentCall) as Extract<Envelope, { kind: 'request' }>;
        const resp = (runtimeId: string): string =>
            JSON.stringify({
                protocol: 'sunbay-checkout',
                major: 1,
                runtimeId,
                checkoutId: 'co_1',
                kind: 'response',
                requestId: req.requestId,
                ok: true,
                data: {},
            });
        post(resp('rt_OLD'), win);
        await vi.advanceTimersByTimeAsync(0);
        expect(box.state).toBe('pending');
        post(resp('rt_1'), win);
        await vi.advanceTimersByTimeAsync(0);
        expect(box.state).toBe('resolved');
        vi.useRealTimers();
    });

    it('concurrent createCheckout do not cross-wire hello', async () => {
        const a = make('co_A');
        const b = make('co_B');
        const spyA = vi.fn();
        const spyB = vi.fn();
        a.t.onHello(spyA);
        b.t.onHello(spyB);
        post(helloWire('rt_B'), b.win);
        expect(spyA).not.toHaveBeenCalled();
        expect(spyB).toHaveBeenCalledTimes(1);
        post(helloWire('rt_A'), a.win);
        expect(spyA).toHaveBeenCalledTimes(1);
        expect(spyA.mock.calls[0][0]).toMatchObject({ runtimeId: 'rt_A' });
        expect(spyB).toHaveBeenCalledTimes(1);
    });
});

function eventWire(name: string, checkoutId: string, runtimeId: string): string {
    return JSON.stringify({
        protocol: 'sunbay-checkout',
        major: 1,
        runtimeId,
        checkoutId,
        kind: 'event',
        eventId: 'evt_1',
        name,
        payload: { elementId: 'el_1' },
    });
}

describe('createCheckout hello validation', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('malformed hello does not throw a raw TypeError and the handshake keeps waiting', async () => {
        vi.useFakeTimers();
        const transport = createMockTransport();
        const hello: { fire: (h: unknown) => void } = { fire: () => undefined };
        transport.onHello = (h): void => {
            hello.fire = h;
        };
        const promise = createCheckout({
            sessionId: 's',
            hostOrigin: HOST_ORIGIN,
            __transportFactory: () => transport,
        });
        const assertion = promise.catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(0);
        expect(() =>
            hello.fire({ protocol: 'sunbay-checkout', kind: 'hello', runtimeId: 'r' })
        ).not.toThrow();
        // A later valid hello still completes the handshake.
        transport.requestImpl = (name): Promise<unknown> =>
            name === 'initialize'
                ? Promise.resolve({ capabilities: [], session: makeSession() } as InitializeResp)
                : Promise.resolve({});
        hello.fire({
            protocol: 'sunbay-checkout',
            kind: 'hello',
            runtimeId: 'r',
            supportedMajorVersions: [1],
            capabilities: [],
        });
        const result = await assertion;
        expect(result).toBeInstanceOf(CheckoutInstance);
    });
});
