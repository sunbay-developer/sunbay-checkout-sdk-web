import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createCheckout } from '../src/createCheckout';
import { CheckoutInstance } from '../src/CheckoutInstance';
import {
    ErrorCode,
    type Appearance,
    type CommandName,
    type InitializeResp,
    type PaymentResultEvent,
    type PaymentOutcome,
    type PublicSessionView,
    type RuntimeHello,
} from '@sunbay/checkout-sdk-protocol';
import type { InstanceTransport } from '../src/CheckoutInstance';

/**
 * createCheckout + CheckoutInstance contract tests (source of truth:
 * js/src/{createCheckout,CheckoutInstance}).
 *
 * Environment: jsdom. transport is a mock (records requests, holds event/hello handlers, can be
 * driven manually). createCheckout allows injecting an internal transport factory
 * (`__transportFactory`) for testing.
 */

const HOST_ORIGIN = 'https://checkout.sunbay-dev.com';

/** mock transport: records requests, holds on/onHello handlers, can trigger events and the handshake manually. */
interface MockTransport extends InstanceTransport {
    requests: { name: CommandName; payload: unknown }[];
    requestImpl: (name: CommandName, payload: unknown) => Promise<unknown>;
    emit: (event: string, payload: unknown) => void;
    fireHello: (hello: RuntimeHello) => void;
    createdIframe: boolean;
    destroyed: boolean;
    injectedRuntimeId: string | null;
}

/** A usable PublicSessionView sample. */
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

/** Default RuntimeHello (supports major version 1). */
function makeHello(): RuntimeHello {
    return {
        protocol: 'sunbay-checkout',
        kind: 'hello',
        runtimeId: 'rt_1',
        supportedMajorVersions: [1],
        capabilities: ['card', 'splitCard', 'address', 'express', 'paymentMethodFilter'],
    };
}

function createMockTransport(): MockTransport {
    const handlers = new Map<string, Set<(payload: unknown) => void>>();
    let helloHandler: ((hello: RuntimeHello) => void) | null = null;
    const transport: MockTransport = {
        requests: [],
        createdIframe: false,
        destroyed: false,
        injectedRuntimeId: null,
        requestImpl(name): Promise<unknown> {
            if (name === 'initialize') {
                const resp: InitializeResp = { capabilities: ['card'], session: makeSession() };
                return Promise.resolve(resp);
            }
            if (name === 'confirm') {
                return Promise.resolve({ accepted: true });
            }
            if (name === 'getSession' || name === 'refresh') {
                return Promise.resolve(makeSession());
            }
            return Promise.resolve({});
        },
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
        onHello(handler): void {
            helloHandler = handler;
        },
        setRuntimeId(runtimeId): void {
            this.injectedRuntimeId = runtimeId;
        },
        createHiddenIframe(): void {
            this.createdIframe = true;
        },
        destroy(): void {
            this.destroyed = true;
        },
        emit(event, payload): void {
            const set = handlers.get(event);
            if (!set) {
                return;
            }
            for (const h of [...set]) {
                h(payload);
            }
        },
        fireHello(hello): void {
            helloHandler?.(hello);
        },
    };
    return transport;
}

/** Start createCheckout and drive hello on the next tick, returning the instance and mock. */
async function bootstrap(
    overrides?: (t: MockTransport) => void,
    createOpts?: { appearance?: Appearance }
): Promise<{ instance: CheckoutInstance; transport: MockTransport }> {
    const transport = createMockTransport();
    overrides?.(transport);
    const promise = createCheckout({
        sessionId: 'sess_1',
        hostOrigin: HOST_ORIGIN,
        appearance: createOpts?.appearance,
        __transportFactory: () => transport,
    });
    // Wait until createHiddenIframe is called & onHello is registered before firing the handshake.
    await Promise.resolve();
    transport.fireHello(makeHello());
    const instance = await promise;
    return { instance, transport };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('createCheckout', () => {
    it('resolves to an instance after hello + initialize', async () => {
        const { instance, transport } = await bootstrap();
        expect(instance).toBeInstanceOf(CheckoutInstance);
        expect(transport.createdIframe).toBe(true);
        // The negotiated runtimeId is injected into transport (otherwise the main endpoint silently drops requests).
        expect(transport.injectedRuntimeId).toBe('rt_1');
        // initialize command was sent.
        expect(transport.requests.some((r) => r.name === 'initialize')).toBe(true);
        // Can read the session returned by initialization.
        const session = await instance.getSession();
        expect(session.sessionId).toBe('sess_1');
    });

    it('exposes the initialize session synchronously on the instance', async () => {
        const { instance, transport } = await bootstrap();
        // No extra command is needed: the snapshot comes from the initialize response.
        expect(instance.session).toEqual(makeSession());
        expect(transport.requests.map((r) => r.name)).toEqual(['initialize']);
    });

    it('session snapshot follows getSession() and refresh()', async () => {
        const { instance } = await bootstrap((t) => {
            t.requestImpl = (name): Promise<unknown> => {
                if (name === 'initialize') {
                    return Promise.resolve({ capabilities: ['card'], session: makeSession() });
                }
                if (name === 'getSession') {
                    return Promise.resolve({ ...makeSession(), totalAmount: 1500 });
                }
                if (name === 'refresh') {
                    return Promise.resolve({ ...makeSession(), totalAmount: 2000 });
                }
                return Promise.resolve({});
            };
        });
        expect(instance.session.totalAmount).toBe(1000);
        await instance.getSession();
        expect(instance.session.totalAmount).toBe(1500);
        await instance.refresh();
        expect(instance.session.totalAmount).toBe(2000);
    });

    it('session stays readable after destroy() (last known snapshot)', async () => {
        const { instance } = await bootstrap();
        instance.destroy();
        expect(instance.session.sessionId).toBe('sess_1');
    });

    it('hello timeout (no handshake) rejects RUNTIME_LOAD_FAILED', async () => {
        vi.useFakeTimers();
        const transport = createMockTransport();
        const promise = createCheckout({
            sessionId: 'sess_1',
            hostOrigin: HOST_ORIGIN,
            __transportFactory: () => transport,
        });
        const assertion = expect(promise).rejects.toMatchObject({
            code: ErrorCode.RUNTIME_LOAD_FAILED,
        });
        await vi.advanceTimersByTimeAsync(15_000);
        await assertion;
        vi.useRealTimers();
    });

    it('no common major version rejects PROTOCOL_UNSUPPORTED', async () => {
        const transport = createMockTransport();
        const promise = createCheckout({
            sessionId: 'sess_1',
            hostOrigin: HOST_ORIGIN,
            __transportFactory: () => transport,
        });
        await Promise.resolve();
        transport.fireHello({ ...makeHello(), supportedMajorVersions: [2, 3] });
        await expect(promise).rejects.toMatchObject({
            code: ErrorCode.PROTOCOL_UNSUPPORTED,
        });
    });
});

describe('CheckoutInstance.create mutual exclusion', () => {
    it("create('cardNumber') after create('card') throws ELEMENT_CONFLICT", async () => {
        const { instance } = await bootstrap();
        instance.create('card');
        expect(() => instance.create('cardNumber')).toThrowError(
            expect.objectContaining({ code: ErrorCode.ELEMENT_CONFLICT })
        );
    });

    it('duplicate mode address throws ELEMENT_CONFLICT', async () => {
        const { instance } = await bootstrap();
        instance.create('address', { mode: 'billing' });
        expect(() => instance.create('address', { mode: 'billing' })).toThrowError(
            expect.objectContaining({ code: ErrorCode.ELEMENT_CONFLICT })
        );
    });

    it('duplicate expressCheckout throws ELEMENT_CONFLICT', async () => {
        const { instance } = await bootstrap();
        instance.create('expressCheckout');
        expect(() => instance.create('expressCheckout')).toThrowError(
            expect.objectContaining({ code: ErrorCode.ELEMENT_CONFLICT })
        );
    });
});

describe('CheckoutInstance.create releases the mutual-exclusion slot after destroy (can recreate)', () => {
    it('expressCheckout can be created again after destroy (does not throw ELEMENT_CONFLICT)', async () => {
        const { instance } = await bootstrap();
        const el = instance.create('expressCheckout');
        el.destroy();
        // After releasing the slot it should be recreatable (e.g. switching buttonType/buttonHeight requires rebuilding the iframe).
        expect(() => instance.create('expressCheckout')).not.toThrow();
    });

    it('combined card can be created again after destroy, and mutual exclusion is lifted (can switch to split fields)', async () => {
        const { instance } = await bootstrap();
        const card = instance.create('card');
        card.destroy();
        // After releasing the slot the same singleton can be rebuilt.
        const card2 = instance.create('card');
        // While card exists it is mutually exclusive with split fields.
        expect(() => instance.create('cardNumber')).toThrowError(
            expect.objectContaining({ code: ErrorCode.ELEMENT_CONFLICT })
        );
        // After destroying card, the card↔split-field mutual exclusion is lifted.
        card2.destroy();
        expect(() => instance.create('cardNumber')).not.toThrow();
    });

    it('a split field can be created again after destroy; duplicate while not destroyed still throws', async () => {
        const { instance } = await bootstrap();
        const cn = instance.create('cardNumber');
        // Duplicate of the same type while not destroyed still conflicts.
        expect(() => instance.create('cardNumber')).toThrowError(
            expect.objectContaining({ code: ErrorCode.ELEMENT_CONFLICT })
        );
        cn.destroy();
        expect(() => instance.create('cardNumber')).not.toThrow();
    });

    it('address with the same mode can be created again after destroy; different modes always coexist', async () => {
        const { instance } = await bootstrap();
        const billing = instance.create('address', { mode: 'billing' });
        // Different modes coexist without conflict.
        expect(() => instance.create('address', { mode: 'shipping' })).not.toThrow();
        // Same mode while not destroyed still conflicts.
        expect(() => instance.create('address', { mode: 'billing' })).toThrowError(
            expect.objectContaining({ code: ErrorCode.ELEMENT_CONFLICT })
        );
        billing.destroy();
        expect(() => instance.create('address', { mode: 'billing' })).not.toThrow();
    });

    it('unmount does not release the slot (still occupied, semantics unchanged)', async () => {
        const { instance } = await bootstrap();
        const el = instance.create('expressCheckout');
        await el.unmount();
        // unmount keeps the handle for remount, still occupying the mutual-exclusion slot.
        expect(() => instance.create('expressCheckout')).toThrowError(
            expect.objectContaining({ code: ErrorCode.ELEMENT_CONFLICT })
        );
    });

    it('instance.destroy with multiple elements does not error, then create throws INSTANCE_DESTROYED', async () => {
        const { instance } = await bootstrap();
        instance.create('expressCheckout');
        instance.create('cardNumber');
        instance.create('address', { mode: 'billing' });
        expect(() => instance.destroy()).not.toThrow();
        expect(() => instance.create('card')).toThrowError(
            expect.objectContaining({ code: ErrorCode.INSTANCE_DESTROYED })
        );
    });
});

describe('CheckoutInstance colorScheme passthrough', () => {
    it("create an instance with appearance.colorScheme='dark' and mount element → iframe src contains colorScheme=dark", async () => {
        const { instance } = await bootstrap(undefined, {
            appearance: { colorScheme: 'dark' },
        });
        const element = instance.create('card');
        const container = document.createElement('div');
        container.id = 'cs-instance-target';
        document.body.appendChild(container);

        void element.mount(container);
        const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
        expect(src).toContain('colorScheme=dark');

        document.body.innerHTML = '';
    });

    it("updateCheckout({ appearance: { colorScheme: 'light' } }) sends updateCheckout command and payload contains that colorScheme", async () => {
        const { instance, transport } = await bootstrap();
        const patch: { appearance: Appearance } = { appearance: { colorScheme: 'light' } };
        await instance.updateCheckout(patch);
        const req = transport.requests.find((r) => r.name === 'updateCheckout');
        expect(req).toBeDefined();
        expect(req?.payload).toMatchObject({ appearance: { colorScheme: 'light' } });
    });
});

describe('CheckoutInstance appearance variables/rules serialized into iframe src', () => {
    /** Parse the appearance param from the iframe src query and JSON-decode it. */
    function parseAppearanceParam(src: string): unknown {
        const q = src.indexOf('?');
        const params = new URLSearchParams(q >= 0 ? src.slice(q) : '');
        const raw = params.get('appearance');
        return raw === null ? undefined : JSON.parse(raw);
    }

    it('after createCheckout with variables + rules, the element iframe src contains &appearance= and decodes to contain those variables/rules', async () => {
        const appearance: Appearance = {
            variables: { colorPrimary: '#ff6000', borderRadius: '8px' },
            rules: { input: { 'font-weight': 'bold' } },
            colorScheme: 'dark',
        };
        const { instance } = await bootstrap(undefined, { appearance });
        const element = instance.create('card');
        const container = document.createElement('div');
        container.id = 'ap-instance-target';
        document.body.appendChild(container);

        void element.mount(container);
        const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
        expect(src).toContain('&appearance=');
        // colorScheme is still passed through separately (no fallback).
        expect(src).toContain('colorScheme=dark');

        const decoded = parseAppearanceParam(src);
        expect(decoded).toMatchObject({
            variables: { colorPrimary: '#ff6000', borderRadius: '8px' },
            rules: { input: { 'font-weight': 'bold' } },
        });

        document.body.innerHTML = '';
    });

    it('does not append &appearance= when appearance only has colorScheme (no variables/rules) (avoid empty string)', async () => {
        const { instance } = await bootstrap(undefined, {
            appearance: { colorScheme: 'light' },
        });
        const element = instance.create('card');
        const container = document.createElement('div');
        container.id = 'ap-instance-empty';
        document.body.appendChild(container);

        void element.mount(container);
        const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
        expect(src).not.toContain('appearance=');
        expect(src).toContain('colorScheme=light');

        document.body.innerHTML = '';
    });
});

describe('CheckoutInstance.confirm', () => {
    it('resolves with a PaymentOutcome after the paymentResult event arrives', async () => {
        const { instance, transport } = await bootstrap();
        const promise = instance.confirm();
        // Wait for the confirm command to be sent and get accepted.
        await Promise.resolve();
        await Promise.resolve();
        const confirmReq = transport.requests.find((r) => r.name === 'confirm');
        expect(confirmReq).toBeDefined();
        const operationId = (confirmReq!.payload as { operationId: string }).operationId;
        const outcome: PaymentOutcome = {
            status: 'succeeded',
            operationId,
            txnId: 'txn_1',
        };
        transport.emit('paymentResult', { operationId, method: 'card', outcome });
        await expect(promise).resolves.toEqual(outcome);
    });

    it('repeated confirm throws CHECKOUT_BUSY', async () => {
        const { instance } = await bootstrap();
        void instance.confirm();
        await Promise.resolve();
        await expect(instance.confirm()).rejects.toMatchObject({
            code: ErrorCode.CHECKOUT_BUSY,
        });
    });
});

describe('CheckoutInstance.destroy', () => {
    it('idempotent, sends destroy command', async () => {
        const { instance, transport } = await bootstrap();
        instance.destroy();
        instance.destroy();
        expect(transport.destroyed).toBe(true);
    });

    it('a late paymentResult after destroy is ignored (does not rewrite an already-settled Promise)', async () => {
        const { instance, transport } = await bootstrap();
        const promise = instance.confirm();
        await Promise.resolve();
        await Promise.resolve();
        const confirmReq = transport.requests.find((r) => r.name === 'confirm');
        const operationId = (confirmReq!.payload as { operationId: string }).operationId;

        // First settle confirm with one result.
        const firstOutcome: PaymentOutcome = {
            status: 'succeeded',
            operationId,
            txnId: 'txn_1',
        };
        transport.emit('paymentResult', { operationId, method: 'card', outcome: firstOutcome });
        await expect(promise).resolves.toEqual(firstOutcome);

        // A late result after destroy must not throw, nor rewrite the already-settled Promise.
        instance.destroy();
        expect(() =>
            transport.emit('paymentResult', {
                operationId,
                method: 'card',
                outcome: { status: 'failed', operationId, error: {} },
            })
        ).not.toThrow();
        // The already-settled Promise result stays unchanged.
        await expect(promise).resolves.toEqual(firstOutcome);
    });
});

describe('CheckoutInstance typed listeners', () => {
    it('off removes a handler registered through on (wrapper map)', async () => {
        const { instance, transport } = await bootstrap();
        const handler = vi.fn();
        instance.on('paymentStateChange', handler);
        instance.off('paymentStateChange', handler);
        transport.emit('paymentStateChange', { operationId: 'op', state: 'processing' });
        expect(handler).not.toHaveBeenCalled();
    });

    it('infers the payload type from the event name', async () => {
        const { instance } = await bootstrap();
        instance.on('paymentResult', (e) => {
            expectTypeOf(e).toEqualTypeOf<PaymentResultEvent>();
            return e.outcome;
        });
    });
});
