import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCheckout } from '../src/createCheckout';
import { CheckoutInstance } from '../src/CheckoutInstance';
import {
    ErrorCode,
    type Appearance,
    type CommandName,
    type InitializeResp,
    type PaymentOutcome,
    type PublicSessionView,
    type RuntimeHello,
} from '@sunbay/checkout-sdk-protocol';
import type { InstanceTransport } from '../src/CheckoutInstance';

/**
 * createCheckout + CheckoutInstance 契约测试（真源：js/src/{createCheckout,CheckoutInstance}）。
 *
 * 环境：jsdom。transport 为 mock（记录 request、持有事件/hello handler，可手动驱动）。
 * createCheckout 允许注入内部 transport 工厂（`__transportFactory`）供测试。
 */

const HOST_ORIGIN = 'https://checkout.sunbay-dev.com';

/** mock transport：记录 request、持有 on/onHello handler，可手动触发事件与握手。 */
interface MockTransport extends InstanceTransport {
    requests: { name: CommandName; payload: unknown }[];
    requestImpl: (name: CommandName, payload: unknown) => Promise<unknown>;
    emit: (event: string, payload: unknown) => void;
    fireHello: (hello: RuntimeHello) => void;
    createdIframe: boolean;
    destroyed: boolean;
    injectedRuntimeId: string | null;
}

/** 一个可用的 PublicSessionView 样例。 */
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

/** 默认 RuntimeHello（支持主版本 1）。 */
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

/** 启动 createCheckout 并在下一 tick 驱动 hello，返回实例与 mock。 */
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
    // 等到 createHiddenIframe 已调用 & onHello 已注册后再触发握手。
    await Promise.resolve();
    transport.fireHello(makeHello());
    const instance = await promise;
    return { instance, transport };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('createCheckout', () => {
    it('等到 hello + initialize 后 resolve 出实例', async () => {
        const { instance, transport } = await bootstrap();
        expect(instance).toBeInstanceOf(CheckoutInstance);
        expect(transport.createdIframe).toBe(true);
        // 握手协商出的 runtimeId 被注入 transport（否则 main 端点会静默丢弃请求）。
        expect(transport.injectedRuntimeId).toBe('rt_1');
        // 发过 initialize 命令。
        expect(transport.requests.some((r) => r.name === 'initialize')).toBe(true);
        // 能读到初始化回来的 session。
        const session = await instance.getSession();
        expect(session.sessionId).toBe('sess_1');
    });

    it('hello 超时（未握手）reject RUNTIME_LOAD_FAILED', async () => {
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

    it('无共同主版本 reject PROTOCOL_UNSUPPORTED', async () => {
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

describe('CheckoutInstance.create 互斥', () => {
    it("create('card') 后再 create('cardNumber') 抛 ELEMENT_CONFLICT", async () => {
        const { instance } = await bootstrap();
        instance.create('card');
        expect(() => instance.create('cardNumber')).toThrowError(
            expect.objectContaining({ code: ErrorCode.ELEMENT_CONFLICT })
        );
    });

    it('重复 mode 地址抛 ELEMENT_CONFLICT', async () => {
        const { instance } = await bootstrap();
        instance.create('address', { mode: 'billing' });
        expect(() => instance.create('address', { mode: 'billing' })).toThrowError(
            expect.objectContaining({ code: ErrorCode.ELEMENT_CONFLICT })
        );
    });

    it('重复 expressCheckout 抛 ELEMENT_CONFLICT', async () => {
        const { instance } = await bootstrap();
        instance.create('expressCheckout');
        expect(() => instance.create('expressCheckout')).toThrowError(
            expect.objectContaining({ code: ErrorCode.ELEMENT_CONFLICT })
        );
    });
});

describe('CheckoutInstance colorScheme 透传', () => {
    it("以 appearance.colorScheme='dark' 创建实例并 mount element → iframe src 含 colorScheme=dark", async () => {
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

    it("updateCheckout({ appearance: { colorScheme: 'light' } }) 发 updateCheckout 命令且 payload 含该 colorScheme", async () => {
        const { instance, transport } = await bootstrap();
        const patch: { appearance: Appearance } = { appearance: { colorScheme: 'light' } };
        await instance.updateCheckout(patch);
        const req = transport.requests.find((r) => r.name === 'updateCheckout');
        expect(req).toBeDefined();
        expect(req?.payload).toMatchObject({ appearance: { colorScheme: 'light' } });
    });
});

describe('CheckoutInstance.confirm', () => {
    it('在 paymentResult 事件到达后以 PaymentOutcome resolve', async () => {
        const { instance, transport } = await bootstrap();
        const promise = instance.confirm();
        // 等 confirm 命令发出并拿到 accepted。
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

    it('重复 confirm 抛 CHECKOUT_BUSY', async () => {
        const { instance } = await bootstrap();
        void instance.confirm();
        await Promise.resolve();
        await expect(instance.confirm()).rejects.toMatchObject({
            code: ErrorCode.CHECKOUT_BUSY,
        });
    });
});

describe('CheckoutInstance.destroy', () => {
    it('幂等，并发 destroy 命令', async () => {
        const { instance, transport } = await bootstrap();
        instance.destroy();
        instance.destroy();
        expect(transport.destroyed).toBe(true);
    });

    it('destroy 后迟到的 paymentResult 被忽略（不改写已结束 Promise）', async () => {
        const { instance, transport } = await bootstrap();
        const promise = instance.confirm();
        await Promise.resolve();
        await Promise.resolve();
        const confirmReq = transport.requests.find((r) => r.name === 'confirm');
        const operationId = (confirmReq!.payload as { operationId: string }).operationId;

        // 先以一次结果兑现 confirm。
        const firstOutcome: PaymentOutcome = {
            status: 'succeeded',
            operationId,
            txnId: 'txn_1',
        };
        transport.emit('paymentResult', { operationId, method: 'card', outcome: firstOutcome });
        await expect(promise).resolves.toEqual(firstOutcome);

        // destroy 后再来一条迟到结果，不得抛错、不得改写已结束 Promise。
        instance.destroy();
        expect(() =>
            transport.emit('paymentResult', {
                operationId,
                method: 'card',
                outcome: { status: 'failed', operationId, error: {} },
            })
        ).not.toThrow();
        // 已结束 Promise 结果保持不变。
        await expect(promise).resolves.toEqual(firstOutcome);
    });
});
