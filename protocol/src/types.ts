/**
 * 协议公开类型（真源）。
 *
 * 这些类型对外公开，供商户侧 SDK（transport/CheckoutInstance/Element）与
 * checkout 托管侧同步副本共同引用。字段与 checkout 后端现有类型对齐，但
 * 对外视图（PublicSessionView）**不含** rsaPublicKey 等敏感/内部字段。
 */

/**
 * 交易状态（直接复用 checkout 后端 TxnStatus，不转义）。
 * - `I` = 未支付 / 已创建（非终态）
 * - `S` = 成功（终态）
 * - `F` = 失败（终态）
 * - `R` = 需跳转 / 处理中（非终态）
 */
export type TxnStatus = 'I' | 'S' | 'F' | 'R';

/**
 * 地址信息（对齐 checkout 后端 AddressInfo 字段）。
 * 非敏感数据，允许经公共协议传输。
 */
export interface AddressInfo {
    country: string;
    state?: string;
    city: string;
    line1: string;
    line2?: string;
    postalCode: string;
    district?: string;
    firstName?: string;
    lastName?: string;
    recipientName?: string;
    phone?: string;
}

/** 首期支持的支付方式。 */
export type PaymentMethod = 'card' | 'applePay' | 'googlePay';

/**
 * 公开支付方式视图（对外只暴露 method/type/name/logoUrl，不含内部配置）。
 */
export interface PublicPaymentMethod {
    method: string;
    type: string;
    name: string;
    logoUrl: string;
}

/** 公开商品行。 */
export interface PublicProductLine {
    amount: number;
    name: string;
    num: string;
}

/**
 * 公开 Session 视图：金额 / 币种 / 商品 / collect 标记 / 可用支付方式 / 商户信息。
 * **不含** rsaPublicKey 等敏感或内部字段。
 */
export interface PublicSessionView {
    sessionId: string;
    sessionType: string;
    currency: string;
    totalAmount: number;
    productList: PublicProductLine[];
    taxAmount: number;
    productAmount: number;
    description: string;
    expiresAt: string;
    collectBillingAddress: boolean;
    collectShippingAddress: boolean;
    paymentMethods: PublicPaymentMethod[];
    merchantName: string;
    merchantLogoUrl: string;
    merchantReturnUrl?: string;
}

/**
 * 支付结果四态（spec 8.2）。
 * `pending` 非终态，消费者不得只接受首条结果。
 */
export type PaymentOutcome =
    | { status: 'succeeded'; operationId: string; txnId: string }
    | { status: 'failed'; operationId: string; txnId?: string; error: CheckoutError }
    | { status: 'canceled'; operationId: string }
    | { status: 'pending'; operationId: string; txnId?: string };

/** 错误分类（spec 5.4）。 */
export type CheckoutErrorCategory =
    | 'configuration'
    | 'validation'
    | 'network'
    | 'runtime'
    | 'payment';

/**
 * 结构化错误（spec 5.4）。
 */
export interface CheckoutError {
    code: string;
    /** 展示用消息。 */
    message: string;
    category: CheckoutErrorCategory;
    errorId: string;
    elementId?: string;
    field?: string;
    traceId?: string;
}

/**
 * 外观定制（appearance）。首期为开放映射，交由托管侧解释。
 */
export interface Appearance {
    theme?: string;
    variables?: Record<string, string>;
}

/**
 * 支付方式过滤配置（spec 9：只做减法/排序，禁止前端增开）。
 */
export interface PaymentMethodFilter {
    /** 要隐藏的支付方式（method 标识）。 */
    hide?: string[];
    /** 展示顺序（method 标识）。 */
    order?: string[];
}

/** 可挂载 Element 类型（spec 6）。 */
export type ElementType =
    | 'card'
    | 'cardNumber'
    | 'cardExpiry'
    | 'cardCvc'
    | 'address'
    | 'expressCheckout';

/** card Element 配置（spec 6）。 */
export interface CardElementOptions {
    showBillingAddress?: boolean;
    showShippingAddress?: boolean;
    showPostalCode?: boolean;
    appearance?: Appearance;
}

/** 拆分卡字段配置（spec 6）。 */
export interface CardFieldElementOptions {
    appearance?: Appearance;
}

/** address Element 配置（spec 6）。 */
export interface AddressElementOptions {
    mode: 'billing' | 'shipping';
    appearance?: Appearance;
}

/** expressCheckout Element 配置（spec 6）。 */
export interface ExpressCheckoutElementOptions {
    /**
     * 各钱包开关（商户显式控制）：
     * - `false`：强制隐藏该钱包；
     * - `true` 或缺省：自动模式，按后端业务允许 ∩ 环境可用展示。
     */
    paymentMethods?: {
        applePay?: boolean;
        googlePay?: boolean;
    };
    /** 布局约束（首期仅最大列数）。 */
    layout?: {
        maxColumns?: number;
    };
    /** 按钮主题（按钱包区分）。 */
    buttonTheme?: {
        applePay?: string;
        googlePay?: string;
    };
    /** 按钮高度（像素）。 */
    buttonHeight?: number;
}

/**
 * express 可用钱包视图（spec 6）。
 * 表示各钱包在当前环境下是否可用，用于 express 可用性事件载荷。
 */
export interface AvailableWallets {
    applePay: boolean;
    googlePay: boolean;
}

/** Element 配置联合（按 type 区分）。 */
export type ElementOptions =
    | CardElementOptions
    | CardFieldElementOptions
    | AddressElementOptions
    | ExpressCheckoutElementOptions;

/** Element 运行状态机（spec 6）。 */
export type ElementStatus = 'created' | 'loading' | 'ready' | 'destroyed' | 'loadError';

/** action 载荷（spec 8.3；qrCode/showContent 首期预留）。 */
export interface PaymentAction {
    type: 'qrCode' | 'redirect' | 'showContent';
    redirectUrl?: string;
    qrData?: string;
    content?: string;
}
