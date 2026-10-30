import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { CheckoutElement } from '../src/Element';
import {
    ErrorCode,
    IFRAME_RESIZE_MESSAGE_TYPE,
    type AvailableWallets,
    type ChangeEvent,
    type CommandName,
    type ElementType,
} from '@sunbay/checkout-sdk-protocol';

/**
 * CheckoutElement contract tests (source of truth: js/src/Element).
 *
 * Environment: jsdom. transport is a mock (records request calls, drives on-registered event
 * handlers). When testing CheckoutElement in isolation, a mock transport, elementId, type and
 * hostOrigin are injected via constructor params.
 */

const HOST_ORIGIN = 'https://checkout.sunbay-dev.com';
const CHECKOUT_ID = 'co_test_1';

/** Set of event handlers (keyed by event name). */
type Handlers = Map<string, Set<(payload: unknown) => void>>;

/** mock transport: records requests, holds on-registered handlers, can trigger events manually. */
interface MockTransport {
    requests: { name: CommandName; payload: unknown }[];
    handlers: Handlers;
    /** request behavior injection: resolve or reject by command name. */
    requestImpl: (name: CommandName, payload: unknown) => Promise<unknown>;
    request: (name: CommandName, payload: unknown) => Promise<unknown>;
    on: (event: string, handler: (payload: unknown) => void) => void;
    off: (event: string, handler: (payload: unknown) => void) => void;
    /** Test helper: dispatch a payload to all handlers of a given event name. */
    emit: (event: string, payload: unknown) => void;
}

function createMockTransport(): MockTransport {
    const handlers: Handlers = new Map();
    const transport: MockTransport = {
        requests: [],
        handlers,
        requestImpl: () => Promise.resolve({ ok: true }),
        request(name, payload) {
            this.requests.push({ name, payload });
            return this.requestImpl(name, payload);
        },
        on(event, handler) {
            let set = handlers.get(event);
            if (!set) {
                set = new Set();
                handlers.set(event, set);
            }
            set.add(handler);
        },
        off(event, handler) {
            handlers.get(event)?.delete(handler);
        },
        emit(event, payload) {
            const set = handlers.get(event);
            if (!set) {
                return;
            }
            for (const h of [...set]) {
                h(payload);
            }
        },
    };
    return transport;
}

/** Construct an Element under test. */
function makeElement(
    transport: MockTransport,
    type: ElementType,
    elementId = 'el_1',
    colorScheme?: 'light' | 'dark' | 'auto',
    appearance?: import('@sunbay/checkout-sdk-protocol').Appearance,
    initialOptions?: import('@sunbay/checkout-sdk-protocol').ElementOptions
): CheckoutElement {
    return new CheckoutElement({
        elementId,
        type,
        hostOrigin: HOST_ORIGIN,
        checkoutId: CHECKOUT_ID,
        transport,
        colorScheme,
        appearance,
        initialOptions,
    });
}

/** Create an empty unique container and attach it to body. */
function makeContainer(id: string): HTMLElement {
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
    return el;
}

/** Input action method signature (focus/blur/clear all return Promise<void>). */
type InputAction = () => Promise<void>;

/** Assert and extract an input action method (type-safe, avoids tsc "possibly undefined" from optional chaining). */
function inputAction(el: CheckoutElement, name: 'focus' | 'blur' | 'clear'): InputAction {
    const fn = el[name];
    if (typeof fn !== 'function') {
        throw new Error(`${name} is undefined`);
    }
    return fn.bind(el);
}

beforeEach(() => {
    document.body.innerHTML = '';
});

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('CheckoutElement.mount', () => {
    it('inserts a visible iframe into the container and resolves after elementReady', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'cardNumber', 'el_card');
        const container = makeContainer('mount-target');

        const mounted = el.mount('#mount-target');
        // The iframe should already be inserted during mount
        const iframe = container.querySelector('iframe');
        expect(iframe).not.toBeNull();
        const src = iframe?.getAttribute('src') ?? '';
        expect(src).toContain(`${HOST_ORIGIN}/sdk/field/cardNumber?`);
        expect(src).toContain(`checkoutId=${CHECKOUT_ID}`);
        // createElement command already sent
        expect(transport.requests.some((r) => r.name === 'createElement')).toBe(true);

        // Fire elementReady for the matching elementId, mount should resolve
        transport.emit('elementReady', { elementId: 'el_card' });
        await expect(mounted).resolves.toBeUndefined();
    });

    it('iframe disables its own scrollbar (scrolling="no") so sub-pixel content never overflows', () => {
        // Regression: on high-DPR (e.g. dpr=2) real browsers, the hosted child reports a
        // ceil()'d content-box height while the actual scrollHeight can be ~1px larger due to
        // sub-pixel rounding, so the default scrolling="auto" iframe shows a spurious scrollbar
        // (notably on the express button). Height is fully driven by the resize protocol, so the
        // iframe must never scroll itself.
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_scroll');
        const container = makeContainer('t-scroll');
        void el.mount(container);
        const iframe = container.querySelector('iframe') as HTMLIFrameElement;
        expect(iframe.getAttribute('scrolling')).toBe('no');
        // Layout invariants that make the auto-resize contract work (width 100%, no border, block).
        expect(iframe.style.border).toBe('0px');
        expect(iframe.style.width).toBe('100%');
        expect(iframe.style.display).toBe('block');
    });

    it('iframe grants payment + publickey-credentials-get permissions scoped to hostOrigin (so cross-origin wallets/WebAuthn work, e.g. Safari 17+ Apple Pay)', () => {
        // Regression: without an allow attribute the browser's Permissions Policy denies the
        // Payment Request API inside the cross-origin element iframe ("payment is not allowed in
        // this document"), so Apple Pay / Google Pay cannot be invoked. All element iframes carry
        // the same allowlist, each feature scoped to 'self' and the hostOrigin (not opened to any
        // other origin), mirroring the mature Stripe setup.
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_allow');
        const container = makeContainer('t-allow');
        void el.mount(container);
        const iframe = container.querySelector('iframe') as HTMLIFrameElement;
        const allow = iframe.getAttribute('allow') ?? '';
        expect(allow).toContain(`payment 'self' ${HOST_ORIGIN}`);
        expect(allow).toContain(`publickey-credentials-get 'self' ${HOST_ORIGIN}`);
    });

    it('all element types (not only expressCheckout) carry the payment allow attribute', () => {
        // The merchant decided every element iframe should be granted the same permissions, so the
        // SDK works uniformly regardless of which element invokes a wallet/WebAuthn flow.
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_allow_card');
        const container = makeContainer('t-allow-card');
        void el.mount(container);
        const iframe = container.querySelector('iframe') as HTMLIFrameElement;
        const allow = iframe.getAttribute('allow') ?? '';
        expect(allow).toContain(`payment 'self' ${HOST_ORIGIN}`);
        expect(allow).toContain(`publickey-credentials-get 'self' ${HOST_ORIGIN}`);
    });

    it('card/address/express use the /sdk/element/<type> path', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_c');
        const container = makeContainer('t2');
        const mounted = el.mount(container);
        const iframe = container.querySelector('iframe');
        expect(iframe?.getAttribute('src') ?? '').toContain(
            `${HOST_ORIGIN}/sdk/element/card?`
        );
        transport.emit('elementReady', { elementId: 'el_c' });
        await mounted;
    });

    it('rejects INVALID_OPTIONS when the container is non-empty', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_c');
        const container = makeContainer('t3');
        container.appendChild(document.createElement('span'));
        await expect(el.mount('#t3')).rejects.toMatchObject({
            code: ErrorCode.INVALID_OPTIONS,
        });
    });

    it('rejects INVALID_OPTIONS when the selector cannot uniquely locate a container', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_c');
        await expect(el.mount('#does-not-exist')).rejects.toMatchObject({
            code: ErrorCode.INVALID_OPTIONS,
        });
    });

    it('repeated mount rejects ELEMENT_CONFLICT', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_c');
        const container = makeContainer('t4');
        const first = el.mount(container);
        transport.emit('elementReady', { elementId: 'el_c' });
        await first;

        const container2 = makeContainer('t4b');
        await expect(el.mount(container2)).rejects.toMatchObject({
            code: ErrorCode.ELEMENT_CONFLICT,
        });
    });

    it('loadError event makes mount reject and removes the iframe node', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_c');
        const container = makeContainer('t5');
        const mounted = el.mount(container);
        transport.emit('loadError', {
            elementId: 'el_c',
            error: {
                code: ErrorCode.RUNTIME_LOAD_FAILED,
                message: 'boom',
                category: 'runtime',
                errorId: 'e1',
            },
        });
        await expect(mounted).rejects.toMatchObject({ code: ErrorCode.RUNTIME_LOAD_FAILED });
        expect(container.querySelector('iframe')).toBeNull();
    });
});

describe('CheckoutElement colorScheme passthrough to iframe src', () => {
    it('iframe src carries colorScheme=<value> when colorScheme is provided', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_cs', 'dark');
        const container = makeContainer('t-cs-dark');
        void el.mount(container);
        const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
        expect(src).toContain('colorScheme=dark');
    });

    it("colorScheme='auto' is passed through too", () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'cardNumber', 'el_cs2', 'auto');
        const container = makeContainer('t-cs-auto');
        void el.mount(container);
        const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
        expect(src).toContain('colorScheme=auto');
    });

    it('iframe src does not contain the colorScheme param when colorScheme is not provided', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_cs3');
        const container = makeContainer('t-cs-none');
        void el.mount(container);
        const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
        expect(src).not.toContain('colorScheme');
    });
});

describe('CheckoutElement appearance passthrough to iframe src', () => {
    it('iframe src carries &appearance= when appearance with variables is provided (decoded contains those variables)', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_ap', undefined, {
            variables: { colorPrimary: '#ff6000' },
        });
        const container = makeContainer('t-ap-vars');
        void el.mount(container);
        const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
        expect(src).toContain('&appearance=');
        const params = new URLSearchParams(src.slice(src.indexOf('?')));
        const decoded = JSON.parse(params.get('appearance') ?? 'null');
        expect(decoded).toMatchObject({ variables: { colorPrimary: '#ff6000' } });
    });

    it('iframe src carries &appearance= when appearance with rules is provided (decoded contains those rules)', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'cardNumber', 'el_ap2', undefined, {
            rules: { input: { 'font-weight': 'bold' } },
        });
        const container = makeContainer('t-ap-rules');
        void el.mount(container);
        const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
        expect(src).toContain('&appearance=');
        const params = new URLSearchParams(src.slice(src.indexOf('?')));
        const decoded = JSON.parse(params.get('appearance') ?? 'null');
        expect(decoded).toMatchObject({ rules: { input: { 'font-weight': 'bold' } } });
    });

    it('does not append appearance= when appearance only has colorScheme (no variables/rules) (avoid empty string)', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_ap3', 'dark', {
            colorScheme: 'dark',
        });
        const container = makeContainer('t-ap-empty');
        void el.mount(container);
        const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
        expect(src).not.toContain('appearance=');
        expect(src).toContain('colorScheme=dark');
    });

    it('iframe src does not contain the appearance param when appearance is not provided', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_ap4');
        const container = makeContainer('t-ap-none');
        void el.mount(container);
        const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
        expect(src).not.toContain('appearance=');
    });
});

describe('CheckoutElement expressCheckout options passthrough to iframe src', () => {
    it('buttonHeight is appended as &buttonHeight=<n>', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_bh', undefined, undefined, {
            buttonHeight: 52,
        });
        const container = makeContainer('t-express-bh');
        void el.mount(container);
        const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
        const params = new URLSearchParams(src.slice(src.indexOf('?')));
        expect(params.get('buttonHeight')).toBe('52');
    });

    it('applePay object-form buttonType is appended as &applePayButtonType=<v>', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_abt', undefined, undefined, {
            paymentMethods: { applePay: { buttonType: 'buy' } },
        });
        const container = makeContainer('t-express-abt');
        void el.mount(container);
        const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
        const params = new URLSearchParams(src.slice(src.indexOf('?')));
        expect(params.get('applePayButtonType')).toBe('buy');
    });

    it('googlePay object-form buttonType is appended as &googlePayButtonType=<v>', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_gbt', undefined, undefined, {
            paymentMethods: { googlePay: { buttonType: 'checkout' } },
        });
        const container = makeContainer('t-express-gbt');
        void el.mount(container);
        const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
        const params = new URLSearchParams(src.slice(src.indexOf('?')));
        expect(params.get('googlePayButtonType')).toBe('checkout');
    });

    it('does not append buttonType param when wallet is a boolean toggle (no object)', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_bool', undefined, undefined, {
            paymentMethods: { applePay: false, googlePay: true },
        });
        const container = makeContainer('t-express-bool');
        void el.mount(container);
        const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
        expect(src).not.toContain('applePayButtonType');
        expect(src).not.toContain('googlePayButtonType');
    });

    it('does not append buttonHeight / buttonType params when there are no express options', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_none');
        const container = makeContainer('t-express-opts-none');
        void el.mount(container);
        const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
        expect(src).not.toContain('buttonHeight');
        expect(src).not.toContain('ButtonType');
    });

    it('does not break existing wallet toggle query (applePay/googlePay toggle semantics preserved, object form does not append boolean toggle string)', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_mix', undefined, undefined, {
            paymentMethods: {
                applePay: { buttonType: 'donate' },
                googlePay: false,
            },
            buttonHeight: 30,
        });
        const container = makeContainer('t-express-mix');
        void el.mount(container);
        const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
        const params = new URLSearchParams(src.slice(src.indexOf('?')));
        expect(params.get('applePayButtonType')).toBe('donate');
        expect(params.get('buttonHeight')).toBe('30');
        // An explicitly disabled wallet is still sent as a boolean toggle
        expect(params.get('googlePay')).toBe('false');
    });
});

describe('CheckoutElement.unmount', () => {
    it('idempotent; sends destroyElement and removes iframe; keeps the handle', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_c');
        const container = makeContainer('t6');
        const mounted = el.mount(container);
        transport.emit('elementReady', { elementId: 'el_c' });
        await mounted;

        await el.unmount();
        expect(transport.requests.some((r) => r.name === 'destroyElement')).toBe(true);
        expect(container.querySelector('iframe')).toBeNull();
        // Idempotent: unmount again does not throw
        await expect(el.unmount()).resolves.toBeUndefined();
        // Handle is still usable
        expect(el.elementId).toBe('el_c');
    });
});

describe('CheckoutElement.destroy', () => {
    it('idempotent; subsequent non-destroy/off calls throw INSTANCE_DESTROYED', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'cardNumber', 'el_c');
        el.destroy();
        el.destroy(); // idempotent

        const focus = inputAction(el, 'focus');
        expect(() => focus()).toThrow();
        try {
            focus();
        } catch (e) {
            expect((e as { code: string }).code).toBe(ErrorCode.INSTANCE_DESTROYED);
        }
    });

    it('off does not throw after destroy', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_c');
        const handler = (): void => {};
        el.on('change', handler);
        el.destroy();
        expect(() => el.off('change', handler)).not.toThrow();
    });
});

describe('CheckoutElement input actions', () => {
    it('cardNumber supports focus/blur/clear and sends the corresponding commands', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'cardNumber', 'el_c');
        await inputAction(el, 'focus')();
        await inputAction(el, 'blur')();
        await inputAction(el, 'clear')();
        const names = transport.requests.map((r) => r.name);
        expect(names).toContain('focus');
        expect(names).toContain('blur');
        expect(names).toContain('clear');
    });

    it('expressCheckout does not provide clear (method does not exist)', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_c');
        expect(
            (el as unknown as { clear?: unknown }).clear
        ).toBeUndefined();
        expect((el as unknown as { focus?: unknown }).focus).toBeUndefined();
    });
});

describe('CheckoutElement.update', () => {
    it('sends the updateElement command', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_c');
        await el.update({ showPostalCode: false });
        const req = transport.requests.find((r) => r.name === 'updateElement');
        expect(req).toBeDefined();
        expect(req?.payload).toMatchObject({
            elementId: 'el_c',
            patch: { showPostalCode: false },
        });
    });

    it('update throws INSTANCE_DESTROYED after destroy', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_c');
        el.destroy();
        await expect(el.update({})).rejects.toMatchObject({
            code: ErrorCode.INSTANCE_DESTROYED,
        });
    });

    it('when updateElement rejects, the whole call propagates that reject (does not partially apply local options)', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_c');
        const rejectErr = {
            code: ErrorCode.INVALID_OPTIONS,
            message: 'invalid patch',
            category: 'configuration',
            errorId: 'e_update',
        };
        transport.requestImpl = (name) =>
            name === 'updateElement' ? Promise.reject(rejectErr) : Promise.resolve({ ok: true });
        await expect(el.update({ showPostalCode: false })).rejects.toBe(rejectErr);
    });
});

describe('CheckoutElement strict event matching', () => {
    it("another elementId's elementReady does not trigger this Element's mount resolve", async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_self');
        const container = makeContainer('t-strict');
        const mounted = el.mount(container);

        // Another Element's event on the shared transport: should not drive this mount
        transport.emit('elementReady', { elementId: 'el_other' });
        // Event without elementId: also does not match
        transport.emit('elementReady', {});
        expect(el.getStatus()).toBe('loading');

        // Only this elementId's event resolves
        transport.emit('elementReady', { elementId: 'el_self' });
        await expect(mounted).resolves.toBeUndefined();
        expect(el.getStatus()).toBe('ready');
    });
});

describe('CheckoutElement expressCheckout', () => {
    it('mount inserts an iframe pointing to /sdk/element/expressCheckout', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_express');
        const container = makeContainer('t-express');
        const mounted = el.mount(container);
        const iframe = container.querySelector('iframe');
        expect(iframe).not.toBeNull();
        expect(iframe?.getAttribute('src') ?? '').toContain(
            `${HOST_ORIGIN}/sdk/element/expressCheckout?`
        );
        transport.emit('elementReady', { elementId: 'el_express' });
        await expect(mounted).resolves.toBeUndefined();
    });

    it('does not provide focus/blur/clear (methods do not exist)', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_express');
        expect((el as unknown as { focus?: unknown }).focus).toBeUndefined();
        expect((el as unknown as { blur?: unknown }).blur).toBeUndefined();
        expect((el as unknown as { clear?: unknown }).clear).toBeUndefined();
    });

    it('does not provide confirm (confirm is Instance-level and card-only)', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_express');
        expect((el as unknown as { confirm?: unknown }).confirm).toBeUndefined();
    });

    it('elementReady surfaces availableWallets (readable via getAvailableWallets)', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_express');
        const container = makeContainer('t-express-ready');

        // No availability data before mount
        expect(el.getAvailableWallets()).toBeUndefined();

        const mounted = el.mount(container);
        const wallets: AvailableWallets = { applePay: true, googlePay: false };
        transport.emit('elementReady', { elementId: 'el_express', availableWallets: wallets });
        await expect(mounted).resolves.toBeUndefined();
        expect(el.getAvailableWallets()).toEqual(wallets);
    });

    it("another elementId's elementReady does not pollute this Element's availableWallets", async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_express');
        const container = makeContainer('t-express-strict');
        const mounted = el.mount(container);

        // Another Element's elementReady (carrying availableWallets) should not be written to this Element
        transport.emit('elementReady', {
            elementId: 'el_other',
            availableWallets: { applePay: true, googlePay: true },
        });
        expect(el.getAvailableWallets()).toBeUndefined();

        const wallets: AvailableWallets = { applePay: false, googlePay: true };
        transport.emit('elementReady', { elementId: 'el_express', availableWallets: wallets });
        await mounted;
        expect(el.getAvailableWallets()).toEqual(wallets);
    });

    it('expressAvailabilityChange event surfaces to the on callback and updates getAvailableWallets', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_express');

        const received: AvailableWallets[] = [];
        el.on('expressAvailabilityChange', (payload) => {
            received.push((payload as { availableWallets: AvailableWallets }).availableWallets);
        });

        const wallets: AvailableWallets = { applePay: true, googlePay: true };
        transport.emit('expressAvailabilityChange', { availableWallets: wallets });

        expect(received).toHaveLength(1);
        expect(received[0]).toEqual(wallets);
        // The handle's local availability snapshot is updated in sync
        expect(el.getAvailableWallets()).toEqual(wallets);
    });

    it('paymentResult surfaces to the callback via on', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_express');

        const results: unknown[] = [];
        el.on('paymentResult', (payload) => {
            results.push(payload);
        });

        const evt = {
            operationId: 'op_1',
            method: 'applePay',
            outcome: { status: 'succeeded', operationId: 'op_1', txnId: 'txn_1' },
        };
        transport.emit('paymentResult', evt);

        expect(results).toHaveLength(1);
        expect(results[0]).toEqual(evt);
    });
});

describe('CheckoutElement iframe auto-resize (parent side)', () => {
    /**
     * Fix a contentWindow sentinel object for the jsdom iframe and return it.
     * jsdom's iframe.contentWindow may be null/unstable, so use defineProperty to fix it to a
     * controllable sentinel, to precisely match/mismatch the source via new MessageEvent({ source }).
     */
    function fixContentWindow(iframe: HTMLIFrameElement): Window {
        const sentinel = {} as Window;
        Object.defineProperty(iframe, 'contentWindow', {
            configurable: true,
            get: () => sentinel,
        });
        return sentinel;
    }

    /** Build a resize message event (source/origin/data can be overridden). */
    function resizeEvent(opts: {
        source: Window | null;
        origin: string;
        data: unknown;
    }): MessageEvent {
        return new MessageEvent('message', {
            data: opts.data,
            origin: opts.origin,
            source: opts.source,
        });
    }

    /** Valid resize payload. */
    function resizeData(elementId: string, height: number): unknown {
        return { type: IFRAME_RESIZE_MESSAGE_TYPE, elementId, height };
    }

    it('iframe src carries the elementId param (for the child to echo back verbatim)', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_rsz_src');
        const container = makeContainer('t-rsz-src');
        void el.mount(container);
        const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
        expect(src).toContain('elementId=el_rsz_src');
    });

    it('valid message (source=contentWindow, origin=hostOrigin, elementId matches) sets iframe.style.height', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_rsz');
        const container = makeContainer('t-rsz-ok');
        void el.mount(container);
        const iframe = container.querySelector('iframe') as HTMLIFrameElement;
        const cw = fixContentWindow(iframe);

        window.dispatchEvent(
            resizeEvent({ source: cw, origin: HOST_ORIGIN, data: resizeData('el_rsz', 321) })
        );
        expect(iframe.style.height).toBe('321px');
    });

    it('wrong source (source is not this iframe.contentWindow) is ignored', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_rsz');
        const container = makeContainer('t-rsz-badsrc');
        void el.mount(container);
        const iframe = container.querySelector('iframe') as HTMLIFrameElement;
        fixContentWindow(iframe);

        const otherWindow = {} as Window;
        window.dispatchEvent(
            resizeEvent({
                source: otherWindow,
                origin: HOST_ORIGIN,
                data: resizeData('el_rsz', 500),
            })
        );
        expect(iframe.style.height).toBe('');
    });

    it('wrong origin is ignored', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_rsz');
        const container = makeContainer('t-rsz-badorigin');
        void el.mount(container);
        const iframe = container.querySelector('iframe') as HTMLIFrameElement;
        const cw = fixContentWindow(iframe);

        window.dispatchEvent(
            resizeEvent({
                source: cw,
                origin: 'https://evil.example.com',
                data: resizeData('el_rsz', 500),
            })
        );
        expect(iframe.style.height).toBe('');
    });

    it('elementId mismatch is ignored', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_rsz');
        const container = makeContainer('t-rsz-badid');
        void el.mount(container);
        const iframe = container.querySelector('iframe') as HTMLIFrameElement;
        const cw = fixContentWindow(iframe);

        window.dispatchEvent(
            resizeEvent({
                source: cw,
                origin: HOST_ORIGIN,
                data: resizeData('el_other', 500),
            })
        );
        expect(iframe.style.height).toBe('');
    });

    it('malformed message (not a resize structure) is ignored', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_rsz');
        const container = makeContainer('t-rsz-malformed');
        void el.mount(container);
        const iframe = container.querySelector('iframe') as HTMLIFrameElement;
        const cw = fixContentWindow(iframe);

        // Missing field / wrong type / completely unrelated
        window.dispatchEvent(
            resizeEvent({ source: cw, origin: HOST_ORIGIN, data: { type: 'other', height: 400 } })
        );
        window.dispatchEvent(
            resizeEvent({
                source: cw,
                origin: HOST_ORIGIN,
                data: { type: IFRAME_RESIZE_MESSAGE_TYPE, elementId: 'el_rsz' },
            })
        );
        window.dispatchEvent(
            resizeEvent({ source: cw, origin: HOST_ORIGIN, data: 'not-an-object' })
        );
        expect(iframe.style.height).toBe('');
    });

    it('same height is deduplicated (final value stable)', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_rsz');
        const container = makeContainer('t-rsz-dedupe');
        void el.mount(container);
        const iframe = container.querySelector('iframe') as HTMLIFrameElement;
        const cw = fixContentWindow(iframe);

        window.dispatchEvent(
            resizeEvent({ source: cw, origin: HOST_ORIGIN, data: resizeData('el_rsz', 200) })
        );
        expect(iframe.style.height).toBe('200px');
        // Send the same height again: deduplicated, final value unchanged
        window.dispatchEvent(
            resizeEvent({ source: cw, origin: HOST_ORIGIN, data: resizeData('el_rsz', 200) })
        );
        expect(iframe.style.height).toBe('200px');
        // Send a different height: updated
        window.dispatchEvent(
            resizeEvent({ source: cw, origin: HOST_ORIGIN, data: resizeData('el_rsz', 260) })
        );
        expect(iframe.style.height).toBe('260px');
    });

    it('after destroy the listener is removed: subsequent valid messages no longer change the height', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_rsz');
        const container = makeContainer('t-rsz-destroy');
        // destroy() while loading now rejects the in-flight mount; swallow it here.
        el.mount(container).catch(() => undefined);
        const iframe = container.querySelector('iframe') as HTMLIFrameElement;
        const cw = fixContentWindow(iframe);

        window.dispatchEvent(
            resizeEvent({ source: cw, origin: HOST_ORIGIN, data: resizeData('el_rsz', 150) })
        );
        expect(iframe.style.height).toBe('150px');

        el.destroy();
        // After destroy the iframe is removed; even reusing the old reference to dispatch a valid
        // message should not change its height
        window.dispatchEvent(
            resizeEvent({ source: cw, origin: HOST_ORIGIN, data: resizeData('el_rsz', 999) })
        );
        expect(iframe.style.height).toBe('150px');
    });
});

describe('CheckoutElement typed, element-scoped listeners', () => {
    const change = (elementId: string): ChangeEvent => ({
        elementId,
        empty: false,
        complete: true,
    });

    it('element.on(change) ignores other elementId', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_a');
        const handler = vi.fn();
        el.on('change', handler);

        transport.emit('change', change('el_b'));
        expect(handler).not.toHaveBeenCalled();

        transport.emit('change', change('el_a'));
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('delivers events without an elementId unchanged', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_a');
        const handler = vi.fn();
        el.on('paymentStateChange', handler);
        const evt = { operationId: 'op_1', state: 'processing' };
        transport.emit('paymentStateChange', evt);
        expect(handler).toHaveBeenCalledWith(evt);
    });

    it('off removes a handler registered through on (wrapper map)', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_a');
        const handler = vi.fn();
        el.on('change', handler);
        el.off('change', handler);
        transport.emit('change', change('el_a'));
        expect(handler).not.toHaveBeenCalled();
        expect(transport.handlers.get('change')?.size ?? 0).toBe(0);
    });

    it('destroy removes element listeners', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_a');
        const h1 = vi.fn();
        const h2 = vi.fn();
        el.on('change', h1);
        el.on('focus', h2);
        el.destroy();
        expect(transport.handlers.get('change')?.size ?? 0).toBe(0);
        expect(transport.handlers.get('focus')?.size ?? 0).toBe(0);
        transport.emit('change', change('el_a'));
        expect(h1).not.toHaveBeenCalled();
        expect(() => el.on('change', h1)).toThrow();
    });

    it('infers the payload type from the event name', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_a');
        el.on('change', (e) => {
            expectTypeOf(e).toEqualTypeOf<ChangeEvent>();
            return e.complete;
        });
    });
});
