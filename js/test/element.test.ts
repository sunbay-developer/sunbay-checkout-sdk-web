import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutElement } from '../src/Element';
import {
    ErrorCode,
    IFRAME_RESIZE_MESSAGE_TYPE,
    type AvailableWallets,
    type CommandName,
    type ElementType,
} from '@sunbay/checkout-sdk-protocol';

/**
 * CheckoutElement 契约测试（真源：js/src/Element）。
 *
 * 环境：jsdom。transport 为 mock（记录 request 调用、驱动 on 注册的事件 handler）。
 * CheckoutElement 独立测试时通过构造参注入 mock transport、elementId、type、hostOrigin。
 */

const HOST_ORIGIN = 'https://checkout.sunbay-dev.com';
const CHECKOUT_ID = 'co_test_1';

/** 事件 handler 集合（按事件名）。 */
type Handlers = Map<string, Set<(payload: unknown) => void>>;

/** mock transport：记录 request、持有 on 注册的 handler，可手动触发事件。 */
interface MockTransport {
    requests: { name: CommandName; payload: unknown }[];
    handlers: Handlers;
    /** request 行为注入：按命令名返回 resolve 或 reject。 */
    requestImpl: (name: CommandName, payload: unknown) => Promise<unknown>;
    request: (name: CommandName, payload: unknown) => Promise<unknown>;
    on: (event: string, handler: (payload: unknown) => void) => void;
    off: (event: string, handler: (payload: unknown) => void) => void;
    /** 测试辅助：向某事件名的全部 handler 分发 payload。 */
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

/** 构造一个待测 Element。 */
function makeElement(
    transport: MockTransport,
    type: ElementType,
    elementId = 'el_1',
    colorScheme?: 'light' | 'dark' | 'auto'
): CheckoutElement {
    return new CheckoutElement({
        elementId,
        type,
        hostOrigin: HOST_ORIGIN,
        checkoutId: CHECKOUT_ID,
        transport,
        colorScheme,
    });
}

/** 创建一个空的唯一容器并挂到 body。 */
function makeContainer(id: string): HTMLElement {
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
    return el;
}

/** 输入类动作方法签名（focus/blur/clear 均返回 Promise<void>）。 */
type InputAction = () => Promise<void>;

/** 断言并取出某个输入类动作方法（类型安全，避免可选链导致 tsc 报 possibly undefined）。 */
function inputAction(el: CheckoutElement, name: 'focus' | 'blur' | 'clear'): InputAction {
    const fn = el[name];
    if (typeof fn !== 'function') {
        throw new Error(`${name} 未定义`);
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
    it('在容器插入一个可见 iframe 并在 elementReady 后 resolve', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'cardNumber', 'el_card');
        const container = makeContainer('mount-target');

        const mounted = el.mount('#mount-target');
        // mount 期间应已插入 iframe
        const iframe = container.querySelector('iframe');
        expect(iframe).not.toBeNull();
        const src = iframe?.getAttribute('src') ?? '';
        expect(src).toContain(`${HOST_ORIGIN}/sdk/field/cardNumber?`);
        expect(src).toContain(`checkoutId=${CHECKOUT_ID}`);
        // 已发 createElement 命令
        expect(transport.requests.some((r) => r.name === 'createElement')).toBe(true);

        // 触发对应 elementId 的 elementReady，mount 应 resolve
        transport.emit('elementReady', { elementId: 'el_card' });
        await expect(mounted).resolves.toBeUndefined();
    });

    it('card/address/express 使用 /sdk/element/<type> 路径', async () => {
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

    it('容器非空时 reject INVALID_OPTIONS', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_c');
        const container = makeContainer('t3');
        container.appendChild(document.createElement('span'));
        await expect(el.mount('#t3')).rejects.toMatchObject({
            code: ErrorCode.INVALID_OPTIONS,
        });
    });

    it('选择器无法唯一定位容器时 reject INVALID_OPTIONS', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_c');
        await expect(el.mount('#does-not-exist')).rejects.toMatchObject({
            code: ErrorCode.INVALID_OPTIONS,
        });
    });

    it('重复 mount reject ELEMENT_CONFLICT', async () => {
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

    it('loadError 事件使 mount reject 并移除 iframe 节点', async () => {
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

describe('CheckoutElement colorScheme 透传 iframe src', () => {
    it('提供 colorScheme 时 iframe src 带 colorScheme=<值>', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_cs', 'dark');
        const container = makeContainer('t-cs-dark');
        void el.mount(container);
        const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
        expect(src).toContain('colorScheme=dark');
    });

    it("colorScheme='auto' 同样透传", () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'cardNumber', 'el_cs2', 'auto');
        const container = makeContainer('t-cs-auto');
        void el.mount(container);
        const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
        expect(src).toContain('colorScheme=auto');
    });

    it('未提供 colorScheme 时 iframe src 不含 colorScheme 参数', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_cs3');
        const container = makeContainer('t-cs-none');
        void el.mount(container);
        const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
        expect(src).not.toContain('colorScheme');
    });
});

describe('CheckoutElement.unmount', () => {
    it('幂等；发 destroyElement 并移除 iframe；保留句柄', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_c');
        const container = makeContainer('t6');
        const mounted = el.mount(container);
        transport.emit('elementReady', { elementId: 'el_c' });
        await mounted;

        await el.unmount();
        expect(transport.requests.some((r) => r.name === 'destroyElement')).toBe(true);
        expect(container.querySelector('iframe')).toBeNull();
        // 幂等：再次 unmount 不抛
        await expect(el.unmount()).resolves.toBeUndefined();
        // 句柄仍可用
        expect(el.elementId).toBe('el_c');
    });
});

describe('CheckoutElement.destroy', () => {
    it('幂等；后续非 destroy/off 调用抛 INSTANCE_DESTROYED', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'cardNumber', 'el_c');
        el.destroy();
        el.destroy(); // 幂等

        const focus = inputAction(el, 'focus');
        expect(() => focus()).toThrow();
        try {
            focus();
        } catch (e) {
            expect((e as { code: string }).code).toBe(ErrorCode.INSTANCE_DESTROYED);
        }
    });

    it('destroy 后 off 不抛', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_c');
        const handler = (): void => {};
        el.on('change', handler);
        el.destroy();
        expect(() => el.off('change', handler)).not.toThrow();
    });
});

describe('CheckoutElement input actions', () => {
    it('cardNumber 支持 focus/blur/clear 并发对应命令', async () => {
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

    it('expressCheckout 不提供 clear（方法不存在）', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_c');
        expect(
            (el as unknown as { clear?: unknown }).clear
        ).toBeUndefined();
        expect((el as unknown as { focus?: unknown }).focus).toBeUndefined();
    });
});

describe('CheckoutElement.update', () => {
    it('发 updateElement 命令', async () => {
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

    it('destroy 后 update 抛 INSTANCE_DESTROYED', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_c');
        el.destroy();
        await expect(el.update({})).rejects.toMatchObject({
            code: ErrorCode.INSTANCE_DESTROYED,
        });
    });

    it('updateElement reject 时整次透传该 reject（不部分应用本地 options）', async () => {
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

describe('CheckoutElement 事件严格匹配', () => {
    it('其他 elementId 的 elementReady 不触发本 Element 的 mount resolve', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_self');
        const container = makeContainer('t-strict');
        const mounted = el.mount(container);

        // 共享 transport 上另一 Element 的事件：不应驱动本 mount
        transport.emit('elementReady', { elementId: 'el_other' });
        // 无 elementId 的事件：同样不匹配
        transport.emit('elementReady', {});
        expect(el.getStatus()).toBe('loading');

        // 本 elementId 事件才 resolve
        transport.emit('elementReady', { elementId: 'el_self' });
        await expect(mounted).resolves.toBeUndefined();
        expect(el.getStatus()).toBe('ready');
    });
});

describe('CheckoutElement expressCheckout', () => {
    it('mount 插入指向 /sdk/element/expressCheckout 的 iframe', async () => {
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

    it('不提供 focus/blur/clear（方法不存在）', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_express');
        expect((el as unknown as { focus?: unknown }).focus).toBeUndefined();
        expect((el as unknown as { blur?: unknown }).blur).toBeUndefined();
        expect((el as unknown as { clear?: unknown }).clear).toBeUndefined();
    });

    it('不提供 confirm（confirm 为 Instance 级且仅卡）', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_express');
        expect((el as unknown as { confirm?: unknown }).confirm).toBeUndefined();
    });

    it('elementReady 透出 availableWallets（getAvailableWallets 可读）', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_express');
        const container = makeContainer('t-express-ready');

        // mount 前无可用性数据
        expect(el.getAvailableWallets()).toBeUndefined();

        const mounted = el.mount(container);
        const wallets: AvailableWallets = { applePay: true, googlePay: false };
        transport.emit('elementReady', { elementId: 'el_express', availableWallets: wallets });
        await expect(mounted).resolves.toBeUndefined();
        expect(el.getAvailableWallets()).toEqual(wallets);
    });

    it('其他 elementId 的 elementReady 不污染本 Element 的 availableWallets', async () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'expressCheckout', 'el_express');
        const container = makeContainer('t-express-strict');
        const mounted = el.mount(container);

        // 另一 Element 的 elementReady（携 availableWallets）不应写入本 Element
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

    it('expressAvailabilityChange 事件透出给 on 回调并更新 getAvailableWallets', () => {
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
        // 句柄本地可用性快照同步更新
        expect(el.getAvailableWallets()).toEqual(wallets);
    });

    it('paymentResult 可通过 on 透出给回调', () => {
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

describe('CheckoutElement iframe 自适应高度（parent 侧）', () => {
    /**
     * 为 jsdom iframe 固定一个 contentWindow 哨兵对象，并返回它。
     * jsdom 的 iframe.contentWindow 可能为空/不稳定，用 defineProperty 固定为可控哨兵，
     * 以便用 new MessageEvent({ source }) 精确匹配/错配来源。
     */
    function fixContentWindow(iframe: HTMLIFrameElement): Window {
        const sentinel = {} as Window;
        Object.defineProperty(iframe, 'contentWindow', {
            configurable: true,
            get: () => sentinel,
        });
        return sentinel;
    }

    /** 构造一条 resize 消息事件（可覆写 source/origin/data）。 */
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

    /** 合法 resize 载荷。 */
    function resizeData(elementId: string, height: number): unknown {
        return { type: IFRAME_RESIZE_MESSAGE_TYPE, elementId, height };
    }

    it('iframe src 携带 elementId 参数（供 child 原样回传）', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_rsz_src');
        const container = makeContainer('t-rsz-src');
        void el.mount(container);
        const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
        expect(src).toContain('elementId=el_rsz_src');
    });

    it('合法消息（source=contentWindow、origin=hostOrigin、elementId 匹配）设置 iframe.style.height', () => {
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

    it('来源错误（source 非本 iframe.contentWindow）被忽略', () => {
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

    it('origin 错误被忽略', () => {
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

    it('elementId 不匹配被忽略', () => {
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

    it('畸形消息（非 resize 结构）被忽略', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_rsz');
        const container = makeContainer('t-rsz-malformed');
        void el.mount(container);
        const iframe = container.querySelector('iframe') as HTMLIFrameElement;
        const cw = fixContentWindow(iframe);

        // 缺字段 / 类型错误 / 完全无关
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

    it('相同高度去重（最终值稳定）', () => {
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
        // 再发相同高度：去重，不改变最终值
        window.dispatchEvent(
            resizeEvent({ source: cw, origin: HOST_ORIGIN, data: resizeData('el_rsz', 200) })
        );
        expect(iframe.style.height).toBe('200px');
        // 发不同高度：更新
        window.dispatchEvent(
            resizeEvent({ source: cw, origin: HOST_ORIGIN, data: resizeData('el_rsz', 260) })
        );
        expect(iframe.style.height).toBe('260px');
    });

    it('destroy 后监听器移除：后续合法消息不再改变高度', () => {
        const transport = createMockTransport();
        const el = makeElement(transport, 'card', 'el_rsz');
        const container = makeContainer('t-rsz-destroy');
        void el.mount(container);
        const iframe = container.querySelector('iframe') as HTMLIFrameElement;
        const cw = fixContentWindow(iframe);

        window.dispatchEvent(
            resizeEvent({ source: cw, origin: HOST_ORIGIN, data: resizeData('el_rsz', 150) })
        );
        expect(iframe.style.height).toBe('150px');

        el.destroy();
        // destroy 后 iframe 已移除；即便复用旧引用再派发合法消息，也不应改变其 height
        window.dispatchEvent(
            resizeEvent({ source: cw, origin: HOST_ORIGIN, data: resizeData('el_rsz', 999) })
        );
        expect(iframe.style.height).toBe('150px');
    });
});
