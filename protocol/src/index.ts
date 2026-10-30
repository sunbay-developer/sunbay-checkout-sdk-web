/**
 * Unified export for the protocol contract — `@sunbay/checkout-sdk-protocol` (single source of truth).
 *
 * The merchant SDK (checkout-sdk-web/js) and the checkout hosted runtime (checkout/src/sdk-runtime)
 * share this contract. The in-repo `js` consumes this package via local linking through the pnpm
 * workspace (`workspace:*`); the cross-repo `checkout` consumes the published npm package. The
 * dependency direction is one-way: zero reverse dependencies.
 */

export {
    PROTOCOL_NAME,
    PROTOCOL_MAJOR,
    EnvelopeDecodeError,
    encodeEnvelope,
    decodeEnvelope,
    type Envelope,
    type RuntimeHello,
} from './envelope';

export { ErrorCode, type ErrorCodeValue } from './errors';

export {
    COMMAND_NAMES,
    isCommandName,
    type CommandName,
    type CommandRequestMap,
    type CommandResponseMap,
    type InitializeReq,
    type InitializeResp,
    type CreateElementReq,
    type CreateElementResp,
    type UpdateElementReq,
    type UpdateElementResp,
    type DestroyElementReq,
    type DestroyElementResp,
    type ElementActionReq,
    type ElementActionResp,
    type UpdateCheckoutReq,
    type UpdateCheckoutResp,
    type GetSessionReq,
    type GetSessionResp,
    type GetPaymentStatusReq,
    type GetPaymentStatusResp,
    type ConfirmReq,
    type ConfirmResp,
    type DestroyReq,
    type DestroyResp,
} from './commands';

export {
    EVENT_NAMES,
    isEventName,
    type EventName,
    type EventPayloadMap,
    type ReadyEvent,
    type ElementReadyEvent,
    type ChangeEvent,
    type FocusEvent,
    type BlurEvent,
    type LoadErrorEvent,
    type ExpressAvailabilityChangeEvent,
    type PaymentStateChangeEvent,
    type PaymentResultEvent,
    type ErrorEvent,
} from './events';

export {
    type TxnStatus,
    type AddressInfo,
    type PaymentMethod,
    type PublicPaymentMethod,
    type PublicProductLine,
    type PublicSessionView,
    type PaymentOutcome,
    type CheckoutError,
    type CheckoutErrorCategory,
    type WalletErrorStage,
    type Appearance,
    type AppearanceVariables,
    type AppearanceRuleTarget,
    type AppearanceRuleStyle,
    type PaymentMethodFilter,
    type ElementType,
    type CardElementOptions,
    type CardFieldElementOptions,
    type AddressElementOptions,
    type ApplePayButtonTheme,
    type GooglePayButtonTheme,
    type ApplePayButtonType,
    type GooglePayButtonType,
    type ApplePayOptions,
    type GooglePayOptions,
    type ExpressCheckoutElementOptions,
    type AvailableWallets,
    type ElementOptions,
    type ElementStatus,
    type PaymentAction,
} from './types';

export {
    IFRAME_RESIZE_MESSAGE_TYPE,
    isIframeResizeMessage,
    type IframeResizeMessage,
} from './iframeLayout';
