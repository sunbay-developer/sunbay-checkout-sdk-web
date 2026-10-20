/**
 * 协议契约统一出口 —— `@sunbay/checkout-sdk-protocol`（单一真源）。
 *
 * 商户 SDK（checkout-sdk-web/js）与 checkout 托管运行时（checkout/src/sdk-runtime）
 * 共用本契约。同仓的 `js` 通过 pnpm workspace（`workspace:*`）本地链接消费本包；
 * 跨仓的 `checkout` 消费已发布的 npm 包。依赖方向单向：零反向依赖。
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
    type AvailablePaymentMethodsChangeEvent,
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
    type Appearance,
    type PaymentMethodFilter,
    type ElementType,
    type CardElementOptions,
    type CardFieldElementOptions,
    type AddressElementOptions,
    type ExpressCheckoutElementOptions,
    type AvailableWallets,
    type ElementOptions,
    type ElementStatus,
    type PaymentAction,
} from './types';
