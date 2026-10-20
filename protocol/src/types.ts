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
 * 白名单设计变量（映射到 hosted 侧 `ThemeConfig`，复用现有 `generateThemeStyles` 与深色推导）。
 *
 * 全部可选；值为颜色或长度字符串，由 hosted 侧白名单校验器校验后方可进入 `<style>`。
 * 属性名使用 camelCase（如 `borderRadius`），hosted 侧转 kebab。
 */
export interface AppearanceVariables {
    /** 主色 → `ThemeConfig.primary`（并联动 ring）。 */
    colorPrimary?: string;
    /** 背景色 → background / card / popover。 */
    colorBackground?: string;
    /** 文字色 → foreground。 */
    colorText?: string;
    /** 边框色 → border / input。 */
    colorBorder?: string;
    /** 危险色 → destructive。 */
    colorDanger?: string;
    /** 圆角 → radius（长度值）。 */
    borderRadius?: string;
    /** 字体族 → `:root` font-family（不进 `ThemeConfig`，单独注入）。 */
    fontFamily?: string;
}

/**
 * rules 可定制的元素锚点（语义 key，对应 hosted 侧 `data-sunbay-el`）。
 *
 * 选择器由 hosted 生成，商户只提供语义 key，不接受选择器字符串。
 * - `'input'`：卡号 / 有效期 / CVV 输入框；
 * - `'input:focus'`：输入框聚焦态；
 * - `'input:invalid'`：输入框错误态（`[data-sunbay-invalid]`）；
 * - `'label'`：iframe 内标签文字；
 * - `'error'`：iframe 内错误文字；
 * - `'cardBrand'`：卡品牌图标容器；
 * - `'cvvIcon'`：CVV 图标。
 */
export type AppearanceRuleTarget =
    | 'input'
    | 'input:focus'
    | 'input:invalid'
    | 'label'
    | 'error'
    | 'cardBrand'
    | 'cvvIcon';

/**
 * 单条 rule：白名单 CSS 属性（camelCase 或 kebab）到值的映射。
 *
 * 属性名与值均由 hosted 侧白名单校验后方可进入 `<style>`；非白名单属性 / 非法值被丢弃。
 */
export type AppearanceRuleStyle = Record<string, string>;

/**
 * 外观定制（appearance）。受控两层：`variables`（整体风格的白名单设计变量）+
 * `rules`（关键元素精调的受控语义选择器）。因 iframe 跨域 + PCI 合规，**不开放任意 CSS**。
 *
 * 所有进入 `<style>` 的文本全程由 hosted 侧白名单校验；appearance 不含任何卡值 / 支付参数。
 */
export interface Appearance {
    /** 白名单设计变量（整体风格）。 */
    variables?: AppearanceVariables;
    /** 受控语义规则（关键元素精调）；key 限 `AppearanceRuleTarget`。 */
    rules?: Partial<Record<AppearanceRuleTarget, AppearanceRuleStyle>>;
    /**
     * 配色方案偏好。
     * - `'light'`：浅色；
     * - `'dark'`：深色；
     * - `'auto'`：跟随系统 / 宿主环境。
     *
     * 协议层只定义类型；缺省时的默认语义（SDK 默认 `'light'`）由消费方实现，
     * 协议不强制默认值。向后兼容的可选新增字段。
     */
    colorScheme?: 'light' | 'dark' | 'auto';
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

/** Apple Pay 官方按钮主题。缺省跟随当前配色（浅 black / 深 white）。 */
export type ApplePayButtonTheme = 'black' | 'white' | 'white-outline';

/** Google Pay 官方按钮主题。缺省跟随当前配色（浅 black / 深 white）。 */
export type GooglePayButtonTheme = 'black' | 'white' | 'default';

/** Apple Pay 官方按钮文案类型（`apple-pay-button` 的 `type` 属性，官方全集）。 */
export type ApplePayButtonType =
    | 'plain'
    | 'buy'
    | 'donate'
    | 'check-out'
    | 'book'
    | 'subscribe'
    | 'reload'
    | 'add-money'
    | 'top-up'
    | 'order'
    | 'rent'
    | 'support'
    | 'contribute'
    | 'tip';

/** Google Pay 官方按钮文案类型（`buttonType`，官方全集）。 */
export type GooglePayButtonType =
    | 'buy'
    | 'plain'
    | 'checkout'
    | 'pay'
    | 'donate'
    | 'book'
    | 'order'
    | 'subscribe';

/** Apple Pay 单钱包配置（显示时的细粒度选项）。 */
export interface ApplePayOptions {
    /** 按钮主题；缺省跟随当前配色。 */
    buttonTheme?: ApplePayButtonTheme;
    /** 按钮文案类型；缺省 `'pay'`。 */
    buttonType?: ApplePayButtonType;
}

/** Google Pay 单钱包配置（显示时的细粒度选项）。 */
export interface GooglePayOptions {
    /** 按钮主题；缺省跟随当前配色。 */
    buttonTheme?: GooglePayButtonTheme;
    /** 按钮文案类型；缺省 `'pay'`。 */
    buttonType?: GooglePayButtonType;
}

/** expressCheckout Element 配置（spec 6）。 */
export interface ExpressCheckoutElementOptions {
    /**
     * 各钱包开关 / 配置：
     * - `false`：强制隐藏该钱包；
     * - `true` 或缺省：自动显示（后端业务允许 ∩ 环境可用），主题跟随当前配色；
     * - 配置对象：自动显示，并应用对象内的细粒度配置（如 buttonTheme）。
     */
    paymentMethods?: {
        applePay?: boolean | ApplePayOptions;
        googlePay?: boolean | GooglePayOptions;
    };
    /** 布局约束（首期仅最大列数）。 */
    layout?: {
        maxColumns?: number;
    };
    /** 钱包按钮高度（像素，全局应用到所有钱包按钮）。hosted 侧 clamp 到 [30, 64]；缺省 40。 */
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
