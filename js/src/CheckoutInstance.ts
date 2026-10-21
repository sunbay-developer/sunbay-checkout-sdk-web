/**
 * CheckoutInstance —— 商户侧结账实例句柄（spec 4 / 7 / 8）。
 *
 * 职责：
 * - 由 `createCheckout` 在握手 + initialize 成功后构造（持有已就绪 transport、
 *   runtimeId、capabilities、初始 PublicSessionView）。
 * - `create` 组装并返回 {@link CheckoutElement}，维护**互斥注册表**（card 与拆分
 *   字段互斥、同 mode 地址互斥、expressCheckout 单例 → `ELEMENT_CONFLICT`）。
 * - `confirm` 生成 operationId、发 confirm 命令拿 accepted，Promise 由后续同
 *   operationId 的 `paymentResult` 事件兑现；进行中再 confirm → `CHECKOUT_BUSY`。
 * - `getSession/refresh/getPaymentStatus/updateCheckout` 透传对应命令。
 * - `destroy` 幂等：释放 Element、解绑监听、以 INSTANCE_DESTROYED reject 未决 confirm、
 *   发 destroy 命令并销毁 transport；此后迟到的 `paymentResult` 一律忽略。
 *
 * 安全约束（AGENTS/spec）：本层只搬运协议命令/事件，**绝不触碰卡值**。
 */

import { CheckoutElement, type CheckoutElementOptions } from './Element';
import {
    ErrorCode,
    type Appearance,
    type CheckoutError,
    type CommandName,
    type ConfirmReq,
    type ElementOptions,
    type ElementType,
    type EventName,
    type GetPaymentStatusResp,
    type PaymentOutcome,
    type PaymentResultEvent,
    type PublicSessionView,
    type UpdateCheckoutReq,
} from '@sunbay/checkout-sdk-protocol';

/**
 * CheckoutInstance 依赖的最小 transport 接口（由 MainFrameTransport 满足）。
 *
 * 比 ElementTransport 多出 `onHello/createHiddenIframe/destroy`，供 createCheckout
 * 握手接线与实例销毁使用。单测可注入 mock。
 */
export interface InstanceTransport {
    request(name: CommandName, payload: unknown): Promise<unknown>;
    on(event: EventName, handler: (payload: unknown) => void): void;
    off(event: EventName, handler: (payload: unknown) => void): void;
    onHello(handler: (hello: unknown) => void): void;
    setRuntimeId(runtimeId: string): void;
    createHiddenIframe(): unknown;
    destroy(): void;
}

/** CheckoutInstance 构造参数（由 createCheckout 组装）。 */
export interface CheckoutInstanceOptions {
    /** 结账唯一 id。 */
    checkoutId: string;
    /** 协商后的运行时 id（来自 RuntimeHello）。 */
    runtimeId: string;
    /** 托管页面 origin（不带尾部斜杠）。 */
    hostOrigin: string;
    /** 已就绪 transport。 */
    transport: InstanceTransport;
    /** initialize 返回的 capabilities。 */
    capabilities: string[];
    /** initialize 返回的初始会话视图。 */
    session: PublicSessionView;
    /**
     * 初始外观定制（来自 createCheckout 的 appearance）。
     * 透传给每个 create 出的 Element，序列化进其 iframe src（首帧无闪）：
     * - colorScheme 拼 `&colorScheme=`；
     * - variables/rules 拼 `&appearance=`（仅当非空）。
     * 缺省不拼接。运行时切换走 updateCheckout 命令。
     */
    appearance?: Appearance;
}

/** confirm 可选参数（对齐 ConfirmReq，去掉由实例生成的 operationId）。 */
export type ConfirmOptions = Omit<ConfirmReq, 'operationId'>;

/** 未决 confirm 的配对记录。 */
interface PendingConfirm {
    operationId: string;
    resolve: (outcome: PaymentOutcome) => void;
    reject: (reason: CheckoutError) => void;
}

/** 拆分卡字段类型集合。 */
const CARD_FIELD_TYPES: readonly ElementType[] = ['cardNumber', 'cardExpiry', 'cardCvc'];

/** 生成唯一 id。 */
function genId(prefix: string): string {
    const rand = Math.random().toString(36).slice(2);
    return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

/** 构造一个结构化 CheckoutError。 */
function makeError(
    code: string,
    message: string,
    category: CheckoutError['category'] = 'configuration'
): CheckoutError {
    return {
        code,
        message,
        category,
        errorId: genId('err'),
    };
}

export class CheckoutInstance {
    /** 结账唯一 id。 */
    readonly checkoutId: string;
    /** 协商后的运行时 id。 */
    readonly runtimeId: string;
    /** 协商后的能力集合。 */
    readonly capabilities: readonly string[];

    private readonly hostOrigin: string;
    private readonly transport: InstanceTransport;
    private session: PublicSessionView;
    /** 初始外观定制（透传给 create 出的每个 Element 的 iframe src）。 */
    private readonly appearance: Appearance | undefined;

    /** 已创建的 Element（按 elementId 索引）。 */
    /**
     * 互斥注册表的**单一数据源**：elementId → 已创建的 CheckoutElement。
     * 互斥判定由本 Map 实时推导（见 {@link assertNoConflict}），元素 `destroy()` 经
     * {@link releaseElement} 从本 Map 移除以释放名额（允许销毁后重建同类互斥 Element）。
     */
    private readonly elements = new Map<string, CheckoutElement>();

    /** 当前未决 confirm（同一时刻至多一个）。 */
    private pendingConfirm: PendingConfirm | null = null;
    /** paymentResult 事件订阅 handler（destroy 时解绑）。 */
    private readonly paymentResultHandler: (payload: unknown) => void;

    private destroyed = false;

    constructor(opts: CheckoutInstanceOptions) {
        this.checkoutId = opts.checkoutId;
        this.runtimeId = opts.runtimeId;
        this.capabilities = opts.capabilities;
        this.hostOrigin = opts.hostOrigin;
        this.transport = opts.transport;
        this.session = opts.session;
        this.appearance = opts.appearance;

        this.paymentResultHandler = (payload: unknown): void => {
            this.handlePaymentResult(payload);
        };
        this.transport.on('paymentResult', this.paymentResultHandler);
    }

    /**
     * 创建一个 Element 句柄（不自动挂载；互斥冲突抛 ELEMENT_CONFLICT）。
     *
     * 互斥规则（spec 6）：
     * - 聚合 `card` 与任一拆分字段（cardNumber/cardExpiry/cardCvc）互斥。
     * - 同 `mode`（billing/shipping）的 address 不可重复。
     * - `expressCheckout` 单例。
     *
     * @param type - Element 类型。
     * @param options - 初始 Element 配置。
     * @returns 新建的 CheckoutElement。
     * @throws 已销毁时抛 INSTANCE_DESTROYED；互斥冲突抛 ELEMENT_CONFLICT。
     */
    create(type: ElementType, options?: ElementOptions): CheckoutElement {
        this.assertAlive();
        this.assertNoConflict(type, options);

        const elementId = genId('el');
        const elementOpts: CheckoutElementOptions = {
            elementId,
            type,
            hostOrigin: this.hostOrigin,
            checkoutId: this.checkoutId,
            transport: this.transport,
            initialOptions: options,
            colorScheme: this.appearance?.colorScheme,
            appearance: this.appearance,
            onDestroy: (id: string) => this.releaseElement(id),
        };
        const element = CheckoutElement.create(elementOpts);
        this.elements.set(elementId, element);
        return element;
    }

    /**
     * 发起支付确认。生成 operationId，发 confirm 命令拿 accepted，返回的 Promise
     * 由后续同 operationId 的 paymentResult 事件兑现。进行中再次调用 → CHECKOUT_BUSY。
     *
     * @param opts - 账单/配送地址、姓名、邮箱、returnUrl 等可选参数。
     * @returns 支付终态结果 PaymentOutcome。
     * @throws 已销毁时 reject INSTANCE_DESTROYED；进行中 reject CHECKOUT_BUSY。
     */
    confirm(opts?: ConfirmOptions): Promise<PaymentOutcome> {
        if (this.destroyed) {
            return Promise.reject(
                makeError(ErrorCode.INSTANCE_DESTROYED, 'Checkout instance has been destroyed', 'runtime')
            );
        }
        if (this.pendingConfirm) {
            return Promise.reject(
                makeError(ErrorCode.CHECKOUT_BUSY, 'A payment confirmation is already in progress', 'runtime')
            );
        }

        const operationId = genId('op');
        const payload: ConfirmReq = { ...opts, operationId };

        return new Promise<PaymentOutcome>((resolve, reject) => {
            // 先占位，防止 accepted 之前并发 confirm。
            this.pendingConfirm = { operationId, resolve, reject };
            this.transport.request('confirm', payload).catch((err: unknown) => {
                // confirm 命令本身失败：清理占位并 reject（paymentResult 不会到来）。
                if (this.pendingConfirm && this.pendingConfirm.operationId === operationId) {
                    this.pendingConfirm = null;
                }
                reject(err as CheckoutError);
            });
        });
    }

    /**
     * 获取最新会话视图（透传 getSession 命令并写回本地快照）。
     *
     * @returns 最新 PublicSessionView。
     * @throws 已销毁时 reject INSTANCE_DESTROYED。
     */
    async getSession(): Promise<PublicSessionView> {
        this.assertAlive();
        const resp = (await this.transport.request('getSession', {})) as PublicSessionView;
        this.session = resp;
        return resp;
    }

    /**
     * 刷新会话（透传 refresh 命令并写回本地快照）。
     *
     * @returns 刷新后的 PublicSessionView。
     * @throws 已销毁时 reject INSTANCE_DESTROYED。
     */
    async refresh(): Promise<PublicSessionView> {
        this.assertAlive();
        const resp = (await this.transport.request('refresh', {})) as PublicSessionView;
        this.session = resp;
        return resp;
    }

    /**
     * 查询支付状态（原样返回 TxnStatus，不转义）。
     *
     * @returns txnStatus（可能含 txnId）。
     * @throws 已销毁时 reject INSTANCE_DESTROYED。
     */
    async getPaymentStatus(): Promise<GetPaymentStatusResp> {
        this.assertAlive();
        return (await this.transport.request('getPaymentStatus', {})) as GetPaymentStatusResp;
    }

    /**
     * 更新结账外观/语言（不改会话或金额）。
     *
     * @param patch - locale / appearance 增量。
     * @throws 已销毁时 reject INSTANCE_DESTROYED。
     */
    async updateCheckout(patch: { locale?: string; appearance?: Appearance }): Promise<void> {
        this.assertAlive();
        const payload: UpdateCheckoutReq = patch;
        await this.transport.request('updateCheckout', payload);
    }

    /**
     * 注册 Checkout 级事件 handler（透传 transport）。
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

    /**
     * 销毁实例：幂等。释放全部 Element、解绑 paymentResult 监听、以
     * INSTANCE_DESTROYED reject 未决 confirm、发 destroy 命令并销毁 transport。
     * 此后迟到的 paymentResult 一律忽略，不改写已结束的 Promise。
     */
    destroy(): void {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;

        // 释放全部 Element 句柄。
        for (const element of this.elements.values()) {
            element.destroy();
        }
        this.elements.clear();

        // 解绑 paymentResult 监听（之后迟到结果无 handler 可达）。
        this.transport.off('paymentResult', this.paymentResultHandler);

        // 以 INSTANCE_DESTROYED reject 未决 confirm。
        if (this.pendingConfirm) {
            this.pendingConfirm.reject(
                makeError(ErrorCode.INSTANCE_DESTROYED, 'Checkout instance has been destroyed', 'runtime')
            );
            this.pendingConfirm = null;
        }

        // 通知托管侧并销毁 transport（request 在 destroy 后由 transport 自行拒绝）。
        void Promise.resolve(this.transport.request('destroy', {})).catch(() => undefined);
        this.transport.destroy();
    }

    /** 若已销毁则抛 INSTANCE_DESTROYED。 */
    private assertAlive(): void {
        if (this.destroyed) {
            throw makeError(ErrorCode.INSTANCE_DESTROYED, 'Checkout instance has been destroyed', 'runtime');
        }
    }

    /** 互斥检查：冲突时抛 ELEMENT_CONFLICT（由 elements Map 实时推导，不改变注册表）。 */
    private assertNoConflict(type: ElementType, options?: ElementOptions): void {
        const existing = [...this.elements.values()];
        const has = (t: ElementType): boolean => existing.some((e) => e.type === t);
        const hasCardField = (): boolean => existing.some((e) => CARD_FIELD_TYPES.includes(e.type));

        if (type === 'card') {
            if (has('card')) {
                throw makeError(ErrorCode.ELEMENT_CONFLICT, 'A combined card Element already exists');
            }
            if (hasCardField()) {
                throw makeError(
                    ErrorCode.ELEMENT_CONFLICT,
                    'Combined card and split card fields are mutually exclusive; split card fields already exist'
                );
            }
            return;
        }
        if (CARD_FIELD_TYPES.includes(type)) {
            if (has('card')) {
                throw makeError(
                    ErrorCode.ELEMENT_CONFLICT,
                    'Split card fields and combined card are mutually exclusive; a combined card already exists'
                );
            }
            // 同一拆分字段类型不可重复。
            if (has(type)) {
                throw makeError(
                    ErrorCode.ELEMENT_CONFLICT,
                    `A split card field of type ${type} already exists`
                );
            }
            return;
        }
        if (type === 'address') {
            const mode = (options as { mode?: string } | undefined)?.mode;
            if (mode && existing.some((e) => e.type === 'address' && e.mode === mode)) {
                throw makeError(
                    ErrorCode.ELEMENT_CONFLICT,
                    `An address Element with mode=${mode} already exists`
                );
            }
            return;
        }
        if (type === 'expressCheckout') {
            if (has('expressCheckout')) {
                throw makeError(ErrorCode.ELEMENT_CONFLICT, 'An expressCheckout Element already exists');
            }
            return;
        }
    }

    /**
     * 元素 `destroy()` 回调：从互斥注册表（elements Map）移除该 elementId，释放名额。
     * 幂等；实例整体 destroy 时（已置 destroyed）走统一 `elements.clear()` 路径，此处 no-op，
     * 避免遍历 elements 调 element.destroy() 时的并发修改。
     */
    private releaseElement(elementId: string): void {
        if (this.destroyed) {
            return;
        }
        this.elements.delete(elementId);
    }

    /** 处理 paymentResult 事件：按 operationId 兑现未决 confirm；迟到/不匹配忽略。 */
    private handlePaymentResult(payload: unknown): void {
        if (this.destroyed) {
            return;
        }
        if (typeof payload !== 'object' || payload === null) {
            return;
        }
        const evt = payload as Partial<PaymentResultEvent>;
        const pending = this.pendingConfirm;
        if (!pending) {
            return;
        }
        if (evt.operationId !== pending.operationId) {
            return;
        }
        if (!evt.outcome) {
            return;
        }
        this.pendingConfirm = null;
        pending.resolve(evt.outcome);
    }
}
