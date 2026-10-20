/**
 * createCheckout —— 商户 SDK 的唯一异步入口（spec 4）。
 *
 * 流程：
 * 1. 生成 `checkoutId`，`resolveHostOrigin(env, hostOrigin)` 得托管 origin。
 * 2. 建 transport、`createHiddenIframe()` 加载托管 main iframe。
 * 3. 注册 onHello；等 RuntimeHello（超时 15s → reject RUNTIME_LOAD_FAILED）。
 * 4. 选共同主版本（无交集 → reject PROTOCOL_UNSUPPORTED）。
 * 5. 发 `initialize`（sessionId/locale/appearance/paymentMethods），拿
 *    capabilities + PublicSessionView；任一步失败 reject 并销毁 transport。
 * 6. 用握手 runtimeId 注入 transport，构造并 resolve {@link CheckoutInstance}。
 *
 * 安全约束（AGENTS/spec）：本层只做握手/初始化编排，**绝不触碰卡值**。
 */

import { MainFrameTransport } from './transport/MainFrameTransport';
import { CheckoutInstance, type InstanceTransport } from './CheckoutInstance';
import { resolveHostOrigin, type Env } from './config/env';
import {
    ErrorCode,
    PROTOCOL_MAJOR,
    type Appearance,
    type CheckoutError,
    type InitializeReq,
    type InitializeResp,
    type PaymentMethodFilter,
    type RuntimeHello,
} from '@sunbay/checkout-sdk-protocol';

/** 握手超时（毫秒）：与 transport handshake 超时一致（15s）。 */
const HANDSHAKE_TIMEOUT_MS = 15_000;

/**
 * 创建 CheckoutInstance 时可注入的内部 transport 工厂（仅供测试/高级定制）。
 *
 * 真实场景使用内置 MainFrameTransport；测试可注入 mock 以驱动 hello/事件。
 */
export type TransportFactory = (args: {
    checkoutId: string;
    hostOrigin: string;
}) => InstanceTransport;

/** createCheckout 参数。 */
export interface CreateCheckoutOptions {
    /** 后端创建的结账会话 id（必填）。 */
    sessionId: string;
    /** 运行环境（dev/prod），默认 dev。 */
    env?: Env;
    /** 覆盖托管 origin（优先于 env）。 */
    hostOrigin?: string;
    /** 语言。 */
    locale?: string;
    /** 外观定制。 */
    appearance?: Appearance;
    /** 支付方式过滤（只做减法/排序）。 */
    paymentMethods?: PaymentMethodFilter;
    /** 内部注入点：自定义 transport 工厂（测试用，不属于公开 API 契约）。 */
    __transportFactory?: TransportFactory;
}

/** 生成唯一 id。 */
function genId(prefix: string): string {
    const rand = Math.random().toString(36).slice(2);
    return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

/** 构造一个结构化 CheckoutError（runtime 分类）。 */
function makeError(code: string, message: string): CheckoutError {
    return {
        code,
        message,
        category: 'runtime',
        errorId: genId('err'),
    };
}

/** 默认 transport 工厂：内置 MainFrameTransport。 */
const defaultTransportFactory: TransportFactory = ({ checkoutId, hostOrigin }) =>
    new MainFrameTransport({ checkoutId, hostOrigin });

/**
 * 创建一个结账实例：握手 + 初始化成功后 resolve。
 *
 * @param opts - 结账参数。
 * @returns 就绪的 CheckoutInstance。
 * @throws reject RUNTIME_LOAD_FAILED（握手超时）/ PROTOCOL_UNSUPPORTED（无共同主版本）
 *         / 或 initialize 的业务错误。
 * @example
 * const checkout = await createCheckout({ sessionId: 'sess_x', env: 'prod' });
 */
export async function createCheckout(opts: CreateCheckoutOptions): Promise<CheckoutInstance> {
    const checkoutId = genId('co');
    const hostOrigin = resolveHostOrigin(opts.env, opts.hostOrigin);
    const factory = opts.__transportFactory ?? defaultTransportFactory;
    const transport = factory({ checkoutId, hostOrigin });

    // 启动托管 main iframe（隐藏 0 尺寸）。
    transport.createHiddenIframe();

    let hello: RuntimeHello;
    try {
        hello = await waitForHello(transport);
    } catch (err) {
        transport.destroy();
        throw err;
    }

    // 选共同主版本。
    if (!hello.supportedMajorVersions.includes(PROTOCOL_MAJOR)) {
        transport.destroy();
        throw makeError(
            ErrorCode.PROTOCOL_UNSUPPORTED,
            `No common major protocol version: SDK=${PROTOCOL_MAJOR}, runtime=${JSON.stringify(hello.supportedMajorVersions)}`
        );
    }

    // 注入协商出的 runtimeId：必须在发送 initialize 之前，否则出站信封 runtimeId
    // 为空串，被 main 端点静默丢弃，导致 initialize 超时。
    transport.setRuntimeId(hello.runtimeId);

    // 发 initialize。
    const initReq: InitializeReq = {
        sessionId: opts.sessionId,
        locale: opts.locale,
        appearance: opts.appearance,
        paymentMethods: opts.paymentMethods,
    };
    let initResp: InitializeResp;
    try {
        initResp = (await transport.request('initialize', initReq)) as InitializeResp;
    } catch (err) {
        transport.destroy();
        throw err as CheckoutError;
    }

    return new CheckoutInstance({
        checkoutId,
        runtimeId: hello.runtimeId,
        hostOrigin,
        transport,
        capabilities: initResp.capabilities,
        session: initResp.session,
        colorScheme: opts.appearance?.colorScheme,
    });
}

/** 等待 RuntimeHello；超时 reject RUNTIME_LOAD_FAILED。 */
function waitForHello(transport: InstanceTransport): Promise<RuntimeHello> {
    return new Promise<RuntimeHello>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) {
                return;
            }
            settled = true;
            reject(makeError(ErrorCode.RUNTIME_LOAD_FAILED, 'Timed out waiting for hosted runtime handshake'));
        }, HANDSHAKE_TIMEOUT_MS);

        transport.onHello((raw: unknown) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            resolve(raw as RuntimeHello);
        });
    });
}
