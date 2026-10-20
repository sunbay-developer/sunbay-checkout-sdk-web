import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MainFrameTransport } from '../src/transport/MainFrameTransport';
import { ErrorCode, type CheckoutError, type Envelope } from '@sunbay/checkout-sdk-protocol';

/**
 * transport 契约测试（真源：js/src/transport/MainFrameTransport）。
 *
 * 环境：jsdom。用 mock 的 iframe.contentWindow.postMessage 捕获出站信封，
 * 用 window.dispatchEvent(new MessageEvent('message', ...)) 模拟入站回包。
 */

const HOST_ORIGIN = 'https://checkout.sunbay-dev.com';
const CHECKOUT_ID = 'co_1';
const RUNTIME_ID = 'rt_1';

/** 捕获 postMessage 的出站字符串信封。 */
let sent: string[];

/**
 * 替换 iframe.contentWindow.postMessage，记录出站信封。
 * createHiddenIframe 真实创建 iframe（jsdom 下 contentWindow 存在）。
 */
function patchIframeContentWindow(iframe: HTMLIFrameElement): void {
    const cw = iframe.contentWindow;
    if (!cw) {
        throw new Error('jsdom iframe.contentWindow 为空');
    }
    vi.spyOn(cw, 'postMessage').mockImplementation(((message: unknown) => {
        sent.push(message as string);
    }) as typeof cw.postMessage);
}

/** 解析最近一次出站 request 信封。 */
function lastRequest(): Extract<Envelope, { kind: 'request' }> {
    const wire = sent[sent.length - 1];
    const env = JSON.parse(wire) as Envelope;
    if (env.kind !== 'request') {
        throw new Error('最近一次出站信封不是 request');
    }
    return env;
}

/** 构造一个成功 response 信封字符串。 */
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

/** 构造一个失败 response 信封字符串。 */
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

/** 构造一个 event 信封字符串。 */
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

/** 模拟从托管页面向 window 投递一条 message。 */
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

    it('createHiddenIframe 生成隐藏 0 尺寸 iframe 并挂到 body，src 带 checkoutId', () => {
        const iframe = document.body.querySelector('iframe');
        expect(iframe).not.toBeNull();
        expect(iframe!.src).toBe(`${HOST_ORIGIN}/sdk/main?checkoutId=${CHECKOUT_ID}`);
    });

    it('request 发出 request 信封：含 name/payload/requestId，postMessage 到 iframe', () => {
        // 该用例只检查出站信封，不等待响应；attach 一个 catch 吞掉
        // afterEach destroy() 带来的 INSTANCE_DESTROYED reject，避免未处理拒绝。
        transport.request('getSession', {}).catch(() => undefined);
        const req = lastRequest();
        expect(req.name).toBe('getSession');
        expect(req.checkoutId).toBe(CHECKOUT_ID);
        expect(typeof req.requestId).toBe('string');
        expect(req.requestId.length).toBeGreaterThan(0);
    });

    it('未注入 runtimeId 时出站 request 信封 runtimeId 为空串', () => {
        transport.request('getSession', {}).catch(() => undefined);
        expect(lastRequest().runtimeId).toBe('');
    });

    it('setRuntimeId 后出站 request 信封携带协商 runtimeId', () => {
        // 回归：runtimeId 握手不回填会导致 main 端点静默丢弃请求 → initialize 超时。
        transport.setRuntimeId(RUNTIME_ID);
        transport.request('initialize', { sessionId: 'sess_1' }).catch(() => undefined);
        expect(lastRequest().runtimeId).toBe(RUNTIME_ID);
    });

    it('回 response ok 使 Promise resolve，返回 data', async () => {
        const p = transport.request('getSession', {});
        const req = lastRequest();
        deliver(okResponseWire(req.requestId, { sessionId: 'sess_1' }));
        await expect(p).resolves.toEqual({ sessionId: 'sess_1' });
    });

    it('回 response ok:false 使其 reject 带 CheckoutError', async () => {
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

    it('超时 reject REQUEST_TIMEOUT（普通命令 10s）', async () => {
        vi.useFakeTimers();
        const p = transport.request('getSession', {});
        const assertion = expect(p).rejects.toMatchObject({
            code: ErrorCode.REQUEST_TIMEOUT,
        });
        await vi.advanceTimersByTimeAsync(10_000);
        await assertion;
    });

    it('initialize 默认超时 30s（10s 不触发，30s 触发）', async () => {
        vi.useFakeTimers();
        const p = transport.request('initialize', { sessionId: 'sess_1' });
        const assertion = expect(p).rejects.toMatchObject({
            code: ErrorCode.REQUEST_TIMEOUT,
        });
        // 10s 时仍未决（无 unhandled rejection）
        await vi.advanceTimersByTimeAsync(10_000);
        await vi.advanceTimersByTimeAsync(20_000);
        await assertion;
    });

    it('错误 origin 的 message 被忽略（request 不 resolve）', async () => {
        vi.useFakeTimers();
        const p = transport.request('getSession', {});
        const req = lastRequest();
        deliver(okResponseWire(req.requestId, { sessionId: 'sess_1' }), 'https://evil.example');
        // 错误 origin 被丢弃 → 最终超时 reject
        const assertion = expect(p).rejects.toMatchObject({
            code: ErrorCode.REQUEST_TIMEOUT,
        });
        await vi.advanceTimersByTimeAsync(10_000);
        await assertion;
    });

    it('checkoutId 不匹配的 message 被忽略', async () => {
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

    it('destroy() 后未决 request reject INSTANCE_DESTROYED', async () => {
        const p = transport.request('getSession', {});
        const assertion = expect(p).rejects.toMatchObject({
            code: ErrorCode.INSTANCE_DESTROYED,
        });
        transport.destroy();
        await assertion;
    });

    it('destroy() 后迟到的同 requestId ok response 被忽略，终态仍为 rejected(INSTANCE_DESTROYED)', async () => {
        // 回归：Review Focus“销毁后迟到消息被忽略”。
        // 先 .catch 捕获防止 unhandled rejection；并记录终态以断言绝不被篡改为 resolve。
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

        // destroy() → Promise 以 INSTANCE_DESTROYED reject。
        transport.destroy();
        await observed;
        expect(settled).toBe('rejected');
        expect(settledReason).toMatchObject({ code: ErrorCode.INSTANCE_DESTROYED });

        // 迟到：用相同 requestId 投递一个 ok response 信封。
        // destroyed 守卫 + pending 已清 → 不应抛错，也不应产生额外 resolve。
        expect(() => deliver(okResponseWire(req.requestId, { sessionId: 'late' }))).not.toThrow();

        // 让微任务队列充分推进，确保没有迟到的 settle 改变终态。
        await Promise.resolve();
        await Promise.resolve();

        // 终态不变：仍为 rejected(INSTANCE_DESTROYED)，绝未被篡改为 resolve。
        expect(settled).toBe('rejected');
        expect(settledReason).toMatchObject({ code: ErrorCode.INSTANCE_DESTROYED });
        await expect(p).rejects.toMatchObject({ code: ErrorCode.INSTANCE_DESTROYED });
    });

    it('destroy() 移除 iframe', () => {
        expect(document.body.querySelector('iframe')).not.toBeNull();
        transport.destroy();
        expect(document.body.querySelector('iframe')).toBeNull();
    });

    it('on 注册的 event handler 收到 kind:event 信封的 payload', () => {
        const handler = vi.fn();
        transport.on('ready', handler);
        deliver(eventWire('ready', { elementId: 'el_1' }));
        expect(handler).toHaveBeenCalledWith({ elementId: 'el_1' });
    });

    it('off 注销后不再收到 event', () => {
        const handler = vi.fn();
        transport.on('change', handler);
        transport.off('change', handler);
        deliver(eventWire('change', { elementId: 'el_1', empty: true, complete: false }));
        expect(handler).not.toHaveBeenCalled();
    });

    it('event 的 checkoutId 不匹配时不分发', () => {
        const handler = vi.fn();
        transport.on('ready', handler);
        deliver(eventWire('ready', { elementId: 'el_1' }, 'co_OTHER'));
        expect(handler).not.toHaveBeenCalled();
    });

    it('relay：收 element-online → 向 main 与来源 Element iframe 各 transfer 一个 port', () => {
        // 捕获一次 postMessage 调用的记录（含 transfer 参数）。
        interface PostCall {
            msg: unknown;
            origin: string | undefined;
            ports: readonly MessagePort[] | undefined;
        }
        // main iframe 的 postMessage 记录。beforeEach 已 createHiddenIframe。
        const mainWin = transport.createHiddenIframe().contentWindow as Window;
        const mainCalls: PostCall[] = [];
        vi.spyOn(mainWin, 'postMessage').mockImplementation(((
            msg: unknown,
            origin?: string,
            ports?: readonly MessagePort[]
        ) => {
            mainCalls.push({ msg, origin, ports });
        }) as unknown as typeof mainWin.postMessage);

        // 模拟发起 element-online 的 Element iframe window（event.source）。
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

        // main 侧收到 relay-port + 1 个 port，targetOrigin=hostOrigin。
        expect(mainCalls).toHaveLength(1);
        expect(mainCalls[0].msg).toMatchObject({
            kind: 'relay-port',
            checkoutId: CHECKOUT_ID,
            fieldType: 'cardNumber',
        });
        expect(mainCalls[0].origin).toBe(HOST_ORIGIN);
        expect(mainCalls[0].ports).toHaveLength(1);

        // Element iframe 侧同样收到 relay-port + 1 个 port。
        expect(elementCalls).toHaveLength(1);
        expect(elementCalls[0].msg).toMatchObject({ fieldType: 'cardNumber' });
        expect(elementCalls[0].origin).toBe(HOST_ORIGIN);
        expect(elementCalls[0].ports).toHaveLength(1);

        // main 与 Element 拿到的是同一 channel 的两个不同 port。
        expect(mainCalls[0].ports?.[0]).not.toBe(elementCalls[0].ports?.[0]);
    });

    it('relay：checkoutId 不匹配的 element-online 不分发 port', () => {
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
