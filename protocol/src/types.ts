/**
 * Public protocol types (source of truth).
 *
 * These types are public and shared by the merchant-side SDK (transport/CheckoutInstance/Element)
 * and the checkout hosted-side synchronized copy. Fields align with the existing checkout backend
 * types, but the public view (PublicSessionView) does **not** include sensitive/internal fields
 * such as rsaPublicKey.
 */

/**
 * Transaction status (reuses the checkout backend TxnStatus verbatim, no translation).
 * - `I` = unpaid / created (non-terminal)
 * - `S` = succeeded (terminal)
 * - `F` = failed (terminal)
 * - `R` = requires redirect / processing (non-terminal)
 */
export type TxnStatus = 'I' | 'S' | 'F' | 'R';

/**
 * Status of the checkout session itself (reuses the backend session status verbatim).
 * `txnStatus` only describes the latest transaction; a session may hold several attempts.
 * - `ACTIVE` = payable; stays `ACTIVE` after failed attempts, so the buyer can retry
 * - `COMPLETED` = multi-attempt: paid successfully; single-attempt: the transaction reached a
 *   terminal state (`S` or `F`, check `txnStatus`)
 * - `INACTIVE` = the order was closed or already paid
 * - `EXPIRED` = expired, invalidated by the merchant, or no longer known to the backend. This is
 *   **not** proof that no payment succeeded; use the server-side query-session to confirm.
 *
 * Open union: values added by the backend later are carried without a breaking release.
 */
export type SessionStatus = 'ACTIVE' | 'COMPLETED' | 'INACTIVE' | 'EXPIRED' | (string & {});

/**
 * Address information (aligned with the checkout backend AddressInfo fields).
 * Non-sensitive data; allowed to be transmitted over the public protocol.
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

/**
 * 支付方式，与后端 `paymentMethod` 字段的大写枚举对齐（CARD / GOOGLE_PAY / APPLE_PAY /
 * WECHAT_PAY / ALIPAY ...）。开放式联合：已知三种提供字面量补全与 `===` 窄化，其余后端
 * 枚举无需破坏性发版即可携带。
 */
export type PaymentMethod = 'CARD' | 'GOOGLE_PAY' | 'APPLE_PAY' | (string & {});

/**
 * Public payment method view (only exposes method/type/name/logoUrl, no internal config).
 */
export interface PublicPaymentMethod {
    method: string;
    type: string;
    name: string;
    logoUrl: string;
}

/**
 * A wallet offered by the session (after the merchant's `paymentMethods` filter), as returned by
 * `getPaymentMethods()` in `express`.
 */
export interface ExpressMethodView extends PublicPaymentMethod {
    /**
     * Whether this wallet can pay on the current device/browser. `undefined` until an
     * `expressCheckout` Element has reported its availability (created and ready); the session alone
     * cannot tell.
     */
    available: boolean | undefined;
}

/**
 * The session's payment methods split for layout decisions (`getPaymentMethods()`).
 * `express` holds the wallets (`APPLE_PAY`, `GOOGLE_PAY`); `regular` holds every other method (card
 * brands and other backend methods). Both keep the order of `PublicSessionView.paymentMethods`.
 */
export interface PaymentMethodsView {
    express: ExpressMethodView[];
    regular: PublicPaymentMethod[];
}

/**
 * Snapshot of an input Element's last `change` event (`Element.getState()`). Never contains values.
 */
export interface ElementState {
    empty: boolean;
    complete: boolean;
    /** Only the card number field may carry brand. */
    brand?: string;
    /** The validation error of the last change, absent when the field is valid or untouched. */
    error?: CheckoutError;
}

/** Public product line. */
export interface PublicProductLine {
    amount: number;
    name: string;
    num: string;
}

/**
 * Public session view: amount / currency / products / collect flags / available payment methods /
 * merchant info. Does **not** include sensitive or internal fields such as rsaPublicKey.
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
 * Four payment outcome states (spec 8.2).
 * `pending` is non-terminal; consumers must not accept only the first result.
 */
export type PaymentOutcome =
    | { status: 'succeeded'; operationId: string; txnId: string }
    | { status: 'failed'; operationId: string; txnId?: string; error: CheckoutError }
    | { status: 'canceled'; operationId: string }
    | { status: 'pending'; operationId: string; txnId?: string };

/** Error categories (spec 5.4). */
export type CheckoutErrorCategory =
    | 'configuration'
    | 'validation'
    | 'network'
    | 'runtime'
    | 'payment';

/**
 * Stage of the payment flow in which an error occurred.
 *
 * `availability` is reserved and not emitted yet.
 */
export type WalletErrorStage =
    | 'availability'
    | 'merchantValidation'
    | 'authorization'
    | 'submit'
    | 'poll'
    | 'runtime';

/**
 * Structured error (spec 5.4).
 */
export interface CheckoutError {
    code: string;
    /** Message for display. */
    message: string;
    category: CheckoutErrorCategory;
    errorId: string;
    elementId?: string;
    field?: string;
    traceId?: string;
    /**
     * Wallet-provider error name/code (sanitized string; never a raw provider object).
     */
    providerCode?: string;
    /** Backend business code passthrough. */
    backendCode?: string;
    /**
     * `false` means the payment outcome is unknown and the merchant must NOT blindly retry;
     * reconcile with `getPaymentStatus` first.
     */
    paymentStateKnown?: boolean;
}

/**
 * Whitelisted design variables (mapped to the hosted-side `ThemeConfig`, reusing the existing
 * `generateThemeStyles` and dark-mode derivation).
 *
 * All optional; values are color or length strings, and only enter `<style>` after being validated
 * by the hosted-side whitelist validator. Property names use camelCase (e.g. `borderRadius`); the
 * hosted side converts them to kebab-case.
 */
export interface AppearanceVariables {
    /** Primary color → `ThemeConfig.primary` (also drives ring). */
    colorPrimary?: string;
    /** Background color → background / card / popover. */
    colorBackground?: string;
    /** Text color → foreground. */
    colorText?: string;
    /** Border color → border / input. */
    colorBorder?: string;
    /** Danger color → destructive. */
    colorDanger?: string;
    /** Border radius → radius (length value). */
    borderRadius?: string;
    /** Font family → `:root` font-family (not part of `ThemeConfig`, injected separately). */
    fontFamily?: string;
}

/**
 * Customizable element anchors for rules (semantic keys, corresponding to the hosted-side
 * `data-sunbay-el`).
 *
 * Selectors are generated by the hosted side; merchants only provide semantic keys and selector
 * strings are not accepted.
 * - `'input'`: card number / expiry / CVV input fields;
 * - `'input:focus'`: input focus state;
 * - `'input:invalid'`: input error state (`[data-sunbay-invalid]`);
 * - `'label'`: label text inside the iframe;
 * - `'error'`: error text inside the iframe;
 * - `'cardBrand'`: card brand icon container;
 * - `'cvvIcon'`: CVV icon.
 */
export type AppearanceRuleTarget =
    | 'input'
    | 'input:focus'
    | 'input:invalid'
    | 'label'
    | 'error'
    | 'cardBrand'
    | 'cvvIcon'
    | 'savedCardList'
    | 'savedCard'
    | 'savedCard:selected'
    | 'savedCardDetails'
    | 'savedCardExpiry'
    | 'savedCardActions'
    | 'savedCardAction'
    | 'savedCardRemove'
    | 'savedCardConfirmation'
    | 'savedCardError';

/**
 * A single rule: a mapping from whitelisted CSS properties (camelCase or kebab) to values.
 *
 * Both property names and values only enter `<style>` after hosted-side whitelist validation;
 * non-whitelisted properties / invalid values are discarded.
 */
export type AppearanceRuleStyle = Record<string, string>;

/**
 * Appearance customization. Controlled in two layers: `variables` (whitelisted design variables for
 * the overall style) + `rules` (controlled semantic selectors for fine-tuning key elements). Due to
 * cross-origin iframes + PCI compliance, arbitrary CSS is **not** allowed.
 *
 * All text entering `<style>` is whitelist-validated by the hosted side throughout; appearance
 * contains no card values / payment parameters.
 */
export interface Appearance {
    /** Whitelisted design variables (overall style). */
    variables?: AppearanceVariables;
    /** Controlled semantic rules (fine-tuning key elements); keys limited to `AppearanceRuleTarget`. */
    rules?: Partial<Record<AppearanceRuleTarget, AppearanceRuleStyle>>;
    /**
     * Color scheme preference.
     * - `'light'`: light;
     * - `'dark'`: dark;
     * - `'auto'`: follow the system / host environment.
     *
     * The protocol layer only defines the type; the default semantics when omitted (the SDK defaults
     * to `'light'`) are implemented by the consumer, and the protocol does not enforce a default
     * value. A backward-compatible optional new field.
     */
    colorScheme?: 'light' | 'dark' | 'auto';
}

/**
 * Payment method filter configuration (spec 9: subtraction/ordering only, enabling new methods on
 * the frontend is forbidden).
 */
export interface PaymentMethodFilter {
    /** Payment methods to hide (method identifiers). */
    hide?: string[];
    /** Display order (method identifiers). */
    order?: string[];
}

/** Mountable Element types (spec 6). */
export type ElementType =
    | 'card'
    | 'cardNumber'
    | 'cardExpiry'
    | 'cardCvc'
    | 'address'
    | 'expressCheckout';

/**
 * Card on file (saved card) options of the card Element. Fixed at creation: the card Element
 * does not support `update()`, so recreate it to change these.
 */
export interface CardOnFileOptions {
    /** Allow saved-card management and removal. Defaults to true. */
    managementEnabled?: boolean;
    /** Creation-time COF layout. Theme properties come from appearance. */
    layout?: {
        density?: 'comfortable' | 'compact';
        actions?: 'inline' | 'stacked';
    };

    /**
     * Host switch for card on file. Defaults to `true`. Card on file is effective only when the
     * session allows it, this switch is on, and `customerAccessSecret` was provided at
     * `createCheckout`. The host can turn it off, never on.
     */
    enabled?: boolean;
    /** Whether the "save this card" checkbox starts ticked. Defaults to `false`. */
    saveByDefault?: boolean;
}

/** card Element options (spec 6). */
export interface CardElementOptions {
    /** Saved card behavior; see {@link CardOnFileOptions}. */
    cardOnFile?: CardOnFileOptions;
    showBillingAddress?: boolean;
    showShippingAddress?: boolean;
    showPostalCode?: boolean;
    appearance?: Appearance;
}

/** Split card field options (spec 6). */
export interface CardFieldElementOptions {
    appearance?: Appearance;
}

/**
 * Address form layout.
 * - `'full'`: the country-specific full address form (default).
 * - `'simple'`: country, address line 1 and postal code only (shipping also asks for the
 *   recipient's first and last name).
 */
export type AddressFormStyle = 'full' | 'simple';

/** address Element options (spec 6). */
export interface AddressElementOptions {
    mode: 'billing' | 'shipping';
    /** Form layout; defaults to `'full'`. Fixed at creation (recreate the Element to change it). */
    style?: AddressFormStyle;
    appearance?: Appearance;
}

/** Apple Pay official button theme. Defaults to follow the current color scheme (light black / dark white). */
export type ApplePayButtonTheme = 'black' | 'white' | 'white-outline';

/** Google Pay official button theme. Defaults to follow the current color scheme (light black / dark white). */
export type GooglePayButtonTheme = 'black' | 'white' | 'default';

/** Apple Pay official button text type (the `type` attribute of `apple-pay-button`, full official set). */
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

/** Google Pay official button text type (`buttonType`, full official set). */
export type GooglePayButtonType =
    | 'buy'
    | 'plain'
    | 'checkout'
    | 'pay'
    | 'donate'
    | 'book'
    | 'order'
    | 'subscribe';

/** Apple Pay single-wallet options (fine-grained options when shown). */
export interface ApplePayOptions {
    /** Button theme; defaults to follow the current color scheme. */
    buttonTheme?: ApplePayButtonTheme;
    /** Button text type; defaults to `'pay'`. */
    buttonType?: ApplePayButtonType;
}

/** Google Pay single-wallet options (fine-grained options when shown). */
export interface GooglePayOptions {
    /** Button theme; defaults to follow the current color scheme. */
    buttonTheme?: GooglePayButtonTheme;
    /** Button text type; defaults to `'pay'`. */
    buttonType?: GooglePayButtonType;
}

/** expressCheckout Element options (spec 6). */
export interface ExpressCheckoutElementOptions {
    /**
     * Per-wallet toggle / configuration:
     * - `false`: force-hide this wallet;
     * - `true` or omitted: auto-show (backend business allows ∩ environment available), theme follows
     *   the current color scheme;
     * - config object: auto-show, and apply the fine-grained config in the object (e.g. buttonTheme).
     */
    paymentMethods?: {
        applePay?: boolean | ApplePayOptions;
        googlePay?: boolean | GooglePayOptions;
    };
    /** Layout constraints (first phase: maximum columns only). */
    layout?: {
        maxColumns?: number;
    };
    /** Wallet button height (pixels, applied globally to all wallet buttons). The hosted side clamps to [30, 64]; defaults to 40. */
    buttonHeight?: number;
}

/**
 * Express available wallets view (spec 6).
 * Indicates whether each wallet is available in the current environment; used as the payload for the
 * express availability event.
 */
export interface AvailableWallets {
    applePay: boolean;
    googlePay: boolean;
}

/** Element options union (distinguished by type). */
export type ElementOptions =
    | CardElementOptions
    | CardFieldElementOptions
    | AddressElementOptions
    | ExpressCheckoutElementOptions;

/** Element runtime state machine (spec 6). */
export type ElementStatus = 'created' | 'loading' | 'ready' | 'destroyed' | 'loadError';

/** action payload (spec 8.3; qrCode/showContent reserved for the first phase). */
export interface PaymentAction {
    type: 'qrCode' | 'redirect' | 'showContent';
    redirectUrl?: string;
    qrData?: string;
    content?: string;
}
