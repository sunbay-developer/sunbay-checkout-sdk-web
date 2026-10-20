/**
 * CheckoutElement —— 商户侧 Element 句柄（spec 6）。
 *
 * 职责：
 * - 由 `CheckoutInstance.create` 构造（单测时以 mock transport + 构造参注入）。
 * - 在商户 DOM 目标挂载**可见** iframe，并通过 transport 转发 Element 命令。
 * - 维护状态机 `created → loading → ready → destroyed`（`loadError` 为旁支）。
 * - 订阅 transport 的 `elementReady` / `loadError` 事件，按**自身 elementId** 过滤，
 *   驱动 `mount()` 的 resolve / reject。
 *
 * 安全约束（AGENTS/spec）：本层只做 DOM 挂载与协议命令转发，**绝不触碰卡值**。
 * 卡数据仅存在于托管 iframe 内，不经由本句柄或 transport 传输。
 */

import {
    ErrorCode,
    type AvailableWallets,
    type CheckoutError,
    type CommandName,
    type ElementOptions,
    type ElementStatus,
    type ElementType,
    type EventName,
    type ExpressAvailabilityChangeEvent,
} from '@sunbay/checkout-sdk-protocol';

/**
 * transport 依赖的最小接口（由 MainFrameTransport 满足）。
 *
 * 仅声明 Element 句柄需要的方法，便于单测注入 mock。
 */
export interface ElementTransport {
    request(name: CommandName, payload: unknown): Promise<unknown>;
    on(event: EventName, handler: (payload: unknown) => void): void;
    off(event: EventName, handler: (payload: unknown) => void): void;
}

/** CheckoutElement 构造参数（由 CheckoutInstance.create 组装）。 */
export interface CheckoutElementOptions {
    /** Element 唯一 id（由实例生成，用于命令/事件配对）。 */
    elementId: string;
    /** Element 类型（决定 iframe 路径与可用动作）。 */
    type: ElementType;
    /** 托管页面 origin（不带尾部斜杠）。 */
    hostOrigin: string;
    /**
     * 当前 checkout 会话 id。随 iframe src 以 `?checkoutId=` 下发，供托管字段/element
     * iframe 加入正确的同源信令频道（`sunbay-checkout:<checkoutId>`）与 main 配对；
     * 缺失会导致字段频道名不匹配、永不就绪。
     */
    checkoutId: string;
    /** 传输层。 */
    transport: ElementTransport;
    /** 初始 Element 配置（随 createElement 下发）。 */
    initialOptions?: ElementOptions;
}

/** 事件 payload 的公共结构（含 elementId，用于按自身句柄过滤）。 */
interface WithElementId {
    elementId?: string;
}

/** loadError 事件 payload 结构。 */
interface LoadErrorPayload extends WithElementId {
    error: CheckoutError;
}

/** elementReady 事件 payload 结构（expressCheckout 额外携 availableWallets）。 */
interface ElementReadyPayload extends WithElementId {
    availableWallets?: AvailableWallets;
}

/** 拆分字段类型（走 /sdk/field/<type>）。 */
const FIELD_TYPES: readonly ElementType[] = ['cardNumber', 'cardExpiry', 'cardCvc'];

/** 提供 focus/blur/clear 的输入类（expressCheckout 不含）。 */
const INPUT_TYPES: readonly ElementType[] = [
    'cardNumber',
    'cardExpiry',
    'cardCvc',
    'card',
    'address',
];

/** 生成一个结构化 CheckoutError（configuration 分类，供句柄本地报错）。 */
function makeError(code: string, message: string, elementId?: string): CheckoutError {
    const rand = Math.random().toString(36).slice(2);
    return {
        code,
        message,
        category: 'configuration',
        errorId: `err_${Date.now().toString(36)}_${rand}`,
        elementId,
    };
}

/**
 * 判断 payload 是否指向本 elementId（**严格匹配**）。
 *
 * 仅当 `payload.elementId === elementId` 才视为本 Element 的 elementReady/loadError。
 * 无 elementId 或不等均不匹配，避免 T6 多 Element 共享同一 transport 时事件串扰。
 * （协议保证 elementReady/loadError 始终携带 elementId。）
 */
function matchesElement(payload: unknown, elementId: string): boolean {
    if (typeof payload !== 'object' || payload === null) {
        return false;
    }
    return (payload as WithElementId).elementId === elementId;
}

export class CheckoutElement {
    /** Element 唯一 id。 */
    readonly elementId: string;
    /** Element 类型。 */
    readonly type: ElementType;

    private readonly hostOrigin: string;
    private readonly checkoutId: string;
    private readonly transport: ElementTransport;
    private options: ElementOptions | undefined;

    private status: ElementStatus = 'created';
    private container: HTMLElement | null = null;
    private iframe: HTMLIFrameElement | null = null;

    /** mount 期间临时订阅的事件 handler（resolve/reject 后解绑）。 */
    private readyHandler: ((payload: unknown) => void) | null = null;
    private loadErrorHandler: ((payload: unknown) => void) | null = null;

    /**
     * 仅 expressCheckout：各钱包可用性快照。
     * 初次来自 elementReady.availableWallets，之后随 expressAvailabilityChange 更新。
     */
    private availableWallets: AvailableWallets | undefined;
    /** 仅 expressCheckout：常驻订阅的 expressAvailabilityChange handler（destroy 时解绑）。 */
    private availabilityHandler: ((payload: unknown) => void) | null = null;

    constructor(opts: CheckoutElementOptions) {
        this.elementId = opts.elementId;
        this.type = opts.type;
        this.hostOrigin = opts.hostOrigin;
        this.checkoutId = opts.checkoutId;
        this.transport = opts.transport;
        this.options = opts.initialOptions;
        this.installInputActions();
        this.installExpressAvailability();
    }

    /** 当前状态（只读快照，供外部/测试观测）。 */
    getStatus(): ElementStatus {
        return this.status;
    }

    /**
     * 仅 expressCheckout：返回当前各钱包可用性快照（其他类型恒为 undefined）。
     *
     * 初值来自 elementReady 的 availableWallets，之后由 expressAvailabilityChange 更新。
     *
     * @returns 可用性快照；尚未就绪或非 express 时为 undefined。
     */
    getAvailableWallets(): AvailableWallets | undefined {
        return this.availableWallets;
    }

    /**
     * 挂载到商户 DOM 目标：插入可见 iframe、发 createElement、等 elementReady。
     *
     * @param selectorOrEl - CSS 选择器或 HTMLElement 容器；容器须唯一且为空。
     * @returns elementReady 后 resolve；失败移除节点并 reject（loadError / INVALID_OPTIONS）。
     * @throws 已销毁时抛 INSTANCE_DESTROYED。
     * @example
     * await element.mount('#card-field');
     */
    mount(selectorOrEl: string | HTMLElement): Promise<void> {
        this.assertAlive();

        if (this.status === 'loading' || this.status === 'ready') {
            return Promise.reject(
                makeError(
                    ErrorCode.ELEMENT_CONFLICT,
                    'This Element is already mounted; mount cannot be called twice',
                    this.elementId
                )
            );
        }

        const container = this.resolveContainer(selectorOrEl);
        if (!container) {
            return Promise.reject(
                makeError(
                    ErrorCode.INVALID_OPTIONS,
                    'Target container not found or not uniquely resolvable',
                    this.elementId
                )
            );
        }
        if (container.childElementCount > 0) {
            return Promise.reject(
                makeError(ErrorCode.INVALID_OPTIONS, 'Target container is not empty', this.elementId)
            );
        }

        this.status = 'loading';
        this.container = container;

        const iframe = document.createElement('iframe');
        iframe.src = this.resolveSrc();
        iframe.title = `sunbay-checkout-${this.type}`;
        iframe.setAttribute('data-element-id', this.elementId);
        iframe.style.border = '0';
        iframe.style.width = '100%';
        iframe.style.display = 'block';
        container.appendChild(iframe);
        this.iframe = iframe;

        return new Promise<void>((resolve, reject) => {
            const cleanup = (): void => {
                if (this.readyHandler) {
                    this.transport.off('elementReady', this.readyHandler);
                    this.readyHandler = null;
                }
                if (this.loadErrorHandler) {
                    this.transport.off('loadError', this.loadErrorHandler);
                    this.loadErrorHandler = null;
                }
            };

            const onReady = (payload: unknown): void => {
                if (!matchesElement(payload, this.elementId)) {
                    return;
                }
                cleanup();
                // expressCheckout：捕获 ready 携带的初始钱包可用性。
                const wallets = (payload as ElementReadyPayload).availableWallets;
                if (wallets) {
                    this.availableWallets = wallets;
                }
                this.status = 'ready';
                resolve();
            };

            const onLoadError = (payload: unknown): void => {
                if (!matchesElement(payload, this.elementId)) {
                    return;
                }
                cleanup();
                this.status = 'loadError';
                this.removeIframe();
                const err = (payload as LoadErrorPayload)?.error;
                reject(
                    err ??
                        makeError(
                            ErrorCode.RUNTIME_LOAD_FAILED,
                            'Failed to load Element',
                            this.elementId
                        )
                );
            };

            this.readyHandler = onReady;
            this.loadErrorHandler = onLoadError;
            this.transport.on('elementReady', onReady);
            this.transport.on('loadError', onLoadError);

            // 发 createElement 命令；命令级失败同样走 loadError 旁支。
            this.transport
                .request('createElement', {
                    elementId: this.elementId,
                    type: this.type,
                    options: this.options,
                })
                .catch((cmdErr: unknown) => {
                    cleanup();
                    this.status = 'loadError';
                    this.removeIframe();
                    reject(cmdErr as CheckoutError);
                });
        });
    }

    /**
     * 卸载：发 destroyElement、移除 iframe；幂等；保留句柄与配置。
     *
     * @returns 完成后 resolve（未挂载时直接 resolve）。
     * @throws 已销毁时抛 INSTANCE_DESTROYED。
     */
    async unmount(): Promise<void> {
        this.assertAlive();
        if (this.status !== 'ready' && this.status !== 'loading') {
            // 未挂载：幂等 no-op。
            return;
        }
        try {
            await this.transport.request('destroyElement', { elementId: this.elementId });
        } finally {
            this.removeIframe();
            this.container = null;
            this.status = 'created';
        }
    }

    /**
     * 销毁句柄：幂等；移除 iframe；此后非 destroy/off 调用抛 INSTANCE_DESTROYED。
     */
    destroy(): void {
        if (this.status === 'destroyed') {
            return;
        }
        if (this.readyHandler) {
            this.transport.off('elementReady', this.readyHandler);
            this.readyHandler = null;
        }
        if (this.loadErrorHandler) {
            this.transport.off('loadError', this.loadErrorHandler);
            this.loadErrorHandler = null;
        }
        if (this.availabilityHandler) {
            this.transport.off('expressAvailabilityChange', this.availabilityHandler);
            this.availabilityHandler = null;
        }
        this.removeIframe();
        this.container = null;
        this.status = 'destroyed';
    }

    /**
     * 更新 Element 配置：发 updateElement；非法字段由托管侧整次拒绝。
     *
     * @param patch - 配置增量。
     * @returns 成功写回本地 options 后 resolve。
     * @throws 已销毁时抛 INSTANCE_DESTROYED。
     */
    async update(patch: Partial<ElementOptions>): Promise<void> {
        this.assertAlive();
        const resp = await this.transport.request('updateElement', {
            elementId: this.elementId,
            patch,
        });
        const next = (resp as { options?: ElementOptions } | undefined)?.options;
        if (next) {
            this.options = next;
        }
    }

    /**
     * 注册事件 handler（透传到 transport，按事件名分发）。
     *
     * @param event - 事件名。
     * @param handler - 回调。
     * @throws 已销毁时抛 INSTANCE_DESTROYED。
     */
    on(event: EventName, handler: (payload: unknown) => void): void {
        this.assertAlive();
        this.transport.on(event, handler);
    }

    /**
     * 注销事件 handler（销毁后仍可安全调用）。
     *
     * @param event - 事件名。
     * @param handler - 先前注册的回调。
     */
    off(event: EventName, handler: (payload: unknown) => void): void {
        this.transport.off(event, handler);
    }

    /** 聚焦（仅输入类，expressCheckout 不提供）。 */
    focus?: () => Promise<void>;
    /** 失焦（仅输入类，expressCheckout 不提供）。 */
    blur?: () => Promise<void>;
    /** 清空（仅输入类，expressCheckout 不提供）。 */
    clear?: () => Promise<void>;

    /** 已挂载后安装输入类动作方法（由构造后自动调用）。 */
    private installInputActions(): void {
        if (!INPUT_TYPES.includes(this.type)) {
            return;
        }
        this.focus = (): Promise<void> => this.sendAction('focus');
        this.blur = (): Promise<void> => this.sendAction('blur');
        this.clear = (): Promise<void> => this.sendAction('clear');
    }

    /**
     * 仅 expressCheckout：常驻订阅 expressAvailabilityChange，更新本地可用性快照。
     *
     * 该事件载荷不含 elementId；express 为单例（由 CheckoutInstance 保证），
     * 故无需按 elementId 过滤。非 express 类型不订阅。
     */
    private installExpressAvailability(): void {
        if (this.type !== 'expressCheckout') {
            return;
        }
        const handler = (payload: unknown): void => {
            if (typeof payload !== 'object' || payload === null) {
                return;
            }
            const wallets = (payload as ExpressAvailabilityChangeEvent).availableWallets;
            if (wallets) {
                this.availableWallets = wallets;
            }
        };
        this.availabilityHandler = handler;
        this.transport.on('expressAvailabilityChange', handler);
    }

    /** 发送一条输入类动作命令（销毁后同步抛 INSTANCE_DESTROYED）。 */
    private sendAction(name: 'focus' | 'blur' | 'clear'): Promise<void> {
        this.assertAlive();
        return this.transport.request(name, { elementId: this.elementId }).then(() => undefined);
    }

    /** 若已销毁则抛 INSTANCE_DESTROYED。 */
    private assertAlive(): void {
        if (this.status === 'destroyed') {
            throw makeError(ErrorCode.INSTANCE_DESTROYED, 'Checkout instance has been destroyed', this.elementId);
        }
    }

    /** 解析挂载容器（选择器须唯一命中一个元素）。 */
    private resolveContainer(selectorOrEl: string | HTMLElement): HTMLElement | null {
        if (typeof selectorOrEl !== 'string') {
            return selectorOrEl;
        }
        const nodes = document.querySelectorAll(selectorOrEl);
        if (nodes.length !== 1) {
            return null;
        }
        const node = nodes[0];
        return node instanceof HTMLElement ? node : null;
    }

    /** 解析 iframe src：拆分字段走 /sdk/field/，其余走 /sdk/element/，带 checkoutId。 */
    private resolveSrc(): string {
        const segment = FIELD_TYPES.includes(this.type) ? 'field' : 'element';
        const query = `?checkoutId=${encodeURIComponent(this.checkoutId)}`;
        return `${this.hostOrigin}/sdk/${segment}/${this.type}${query}`;
    }

    /** 移除 iframe DOM 节点（若存在）。 */
    private removeIframe(): void {
        if (this.iframe && this.iframe.parentNode) {
            this.iframe.parentNode.removeChild(this.iframe);
        }
        this.iframe = null;
    }

    /** 工厂：等价于 `new CheckoutElement(opts)`（供 CheckoutInstance 统一入口）。 */
    static create(opts: CheckoutElementOptions): CheckoutElement {
        return new CheckoutElement(opts);
    }
}
