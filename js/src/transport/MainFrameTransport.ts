/**
 * MainFrameTransport —— 商户 SDK 与托管 main iframe 的传输层（spec 5）。
 *
 * 职责：
 * - 创建隐藏 0 尺寸的 main iframe（`${hostOrigin}/sdk/main?checkoutId=...`）。
 * - 发送 request 信封并按 `requestId` 配对响应（resolve/reject）。
 * - 分发 `kind:'event'` 信封到 `on` 注册的 handler。
 * - 过滤安全边界：仅接受 `event.origin === hostOrigin` 且信封 `checkoutId` 匹配的消息。
 * - `destroy()` 清理 iframe/监听，并以 INSTANCE_DESTROYED reject 所有未决 request。
 *
 * 安全约束（AGENTS/spec）：信封中**绝不含卡值**；本层只搬运协议信封，不触碰卡数据。
 * RuntimeHello（`kind:'hello'`）在握手阶段尚无 checkoutId，由本层**单独**识别处理，
 * 不交给 `decodeEnvelope`（后者要求 checkoutId 必填）。
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

/** 构造参数。 */
export interface MainFrameTransportOptions {
    checkoutId: string;
    hostOrigin: string;
}

/** 可配置超时（毫秒）。 */
export interface RequestTimeoutConfig {
    /** 普通命令默认超时。 */
    default: number;
    /** initialize 命令超时。 */
    initialize: number;
    /** 握手（hello）超时。 */
    handshake: number;
}

/** 默认超时时长：普通 10s、initialize 30s、握手 15s。 */
export const DEFAULT_REQUEST_TIMEOUTS: RequestTimeoutConfig = {
    default: 10_000,
    initialize: 30_000,
    handshake: 15_000,
};

/** 事件 handler 签名（payload 为未知结构，由调用方按 EventName 细化）。 */
export type EventHandler = (payload: unknown) => void;

/** 未决请求的配对记录。 */
interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (reason: CheckoutError) => void;
    timer: ReturnType<typeof setTimeout>;
}

/** 生成唯一 id（requestId / errorId）。 */
function genId(prefix: string): string {
    const rand = Math.random().toString(36).slice(2);
    return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

/** 构造一个结构化 CheckoutError（运行时分类）。 */
function makeError(code: string, message: string): CheckoutError {
    return {
        code,
        message,
        category: 'runtime',
        errorId: genId('err'),
    };
}

/**
 * 判断一个未知对象是否为 RuntimeHello（握手阶段，无 checkoutId）。
 *
 * 不依赖 decodeEnvelope —— hello 不属于 Envelope 联合。
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
     * 握手协商出的运行时 id；未注入前为空串。出站 request 信封据此填充，
     * main 端点仅处理 runtimeId 与自身一致的请求，空串会被静默丢弃。
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
     * 创建隐藏 0 尺寸 main iframe，append 到 document.body。
     *
     * @returns 已挂载的 iframe 元素。
     * @example
     * const iframe = transport.createHiddenIframe();
     */
    createHiddenIframe(): HTMLIFrameElement {
        if (this.iframe) {
            return this.iframe;
        }
        const iframe = document.createElement('iframe');
        iframe.src = `${this.hostOrigin}/sdk/main?checkoutId=${this.checkoutId}`;
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
     * 发送一条 request 信封，按 requestId 配对响应。
     *
     * @param name - 命令名。
     * @param payload - 命令载荷（JSON 可序列化）。
     * @returns 响应 data；失败（ok:false / 超时 / destroy）reject 一个 CheckoutError。
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
     * 注册事件 handler（分发 kind:'event' 信封的 payload）。
     *
     * @param event - 事件名。
     * @param handler - 回调。
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
     * 注销事件 handler。
     *
     * @param event - 事件名。
     * @param handler - 先前注册的回调。
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
     * 注册握手（RuntimeHello）回调。hello 阶段尚无 checkoutId，单独处理。
     *
     * @param handler - 收到 hello 时调用。
     */
    onHello(handler: (hello: RuntimeHello) => void): void {
        this.helloHandler = handler;
    }

    /**
     * 注入握手协商出的运行时 id。必须在发送首个 request（initialize）之前调用，
     * 否则出站信封 runtimeId 为空串、被 main 端点静默丢弃导致请求超时。
     *
     * @param runtimeId - RuntimeHello 中的 runtimeId。
     */
    setRuntimeId(runtimeId: string): void {
        this.runtimeId = runtimeId;
    }

    /**
     * 销毁：移除 iframe、清监听，未决 request 以 INSTANCE_DESTROYED reject。
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

    /** 按命令名解析超时时长。 */
    private resolveTimeout(name: CommandName): number {
        if (name === 'initialize') {
            return this.timeouts.initialize;
        }
        return this.timeouts.default;
    }

    /**
     * 点对点 port relay（父窗口中继，Stripe controller 模型）。
     *
     * 兄弟 iframe（main 与各 Element iframe）之间拿不到彼此 window 引用，无法直接
     * transfer MessagePort。本层（商户页，唯一同时可达两端且知其 origin 的角色）在
     * 收到某 Element iframe 的 `element-online` 时：
     * 1. 建 `MessageChannel`；
     * 2. `port1` → main iframe（`relay-port`，targetOrigin=hostOrigin）；
     * 3. `port2` → 发起的 Element iframe（即 `event.source`，targetOrigin=hostOrigin）。
     *
     * 两端 origin 均为 hostOrigin，targetOrigin 恒正确（跨域亦不被丢弃）。
     * 本层只搬运**空 port**，绝不接触卡值（卡值在 port 建立后端到端传输）。
     *
     * @param event 入站 message（origin 已校验为 hostOrigin）
     * @returns 是否作为 element-online 处理（是则调用方应 return）
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
        // 校验：checkoutId 匹配、fieldType 合法、来源窗口存在。
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
        // port1 → main iframe；port2 → 发起的 Element iframe。
        mainWin.postMessage(relayMsg, this.hostOrigin, [channel.port1]);
        elementWin.postMessage(relayMsg, this.hostOrigin, [channel.port2]);
        return true;
    }

    /** 处理入站 message：过滤 origin，识别 relay / hello / Envelope 并分发。 */
    private handleMessage(event: MessageEvent): void {
        if (this.destroyed) {
            return;
        }
        // 安全边界：只接受来自托管页面 origin 的消息。
        if (event.origin !== this.hostOrigin) {
            return;
        }

        // 点对点 port relay：Element iframe 上线 → 本层（父窗口）建 channel，
        // 把两个 port 分别 transfer 给 main iframe 与该 Element iframe（见下）。
        // relay 消息为对象（非 string 信封），且须先于 string 校验识别。
        if (this.tryHandleElementOnline(event)) {
            return;
        }

        if (typeof event.data !== 'string') {
            return;
        }

        // 握手 hello 单独解析（不走 Envelope 联合，此阶段无 checkoutId）。
        let raw: unknown;
        try {
            raw = JSON.parse(event.data);
        } catch {
            return;
        }
        if (isRuntimeHello(raw)) {
            if (this.helloHandler) {
                this.helloHandler(raw);
            }
            return;
        }

        // 其余按 Envelope 校验解码。
        let envelope: Envelope;
        try {
            envelope = decodeEnvelope(event.data);
        } catch {
            return;
        }

        // 安全边界：信封 checkoutId 必须匹配本实例。
        if (envelope.checkoutId !== this.checkoutId) {
            return;
        }

        if (envelope.kind === 'response') {
            this.handleResponse(envelope);
        } else if (envelope.kind === 'event') {
            this.handleEvent(envelope);
        }
        // kind:'request' 由 main → SDK 不应出现，忽略。
    }

    /** 分发 response 到配对的未决 request。 */
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

    /** 分发 event 到注册的 handler。 */
    private handleEvent(envelope: Extract<Envelope, { kind: 'event' }>): void {
        const set = this.eventHandlers.get(envelope.name as EventName);
        if (!set) {
            return;
        }
        for (const handler of set) {
            handler(envelope.payload);
        }
    }
}
