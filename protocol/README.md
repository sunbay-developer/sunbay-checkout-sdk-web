# @sunbay/checkout-sdk-protocol

The shared protocol contract between the **Sunbay Checkout SDK** and the
**Sunbay-hosted runtime** — the single source of truth both sides depend on.

This package contains **types and constants only** (no runtime side effects). It
defines the message envelope, commands, events, error codes, and public data
shapes exchanged between the merchant-facing SDK (`@sunbay/checkout-sdk-js`) and
the Sunbay-hosted iframe runtime. The dependency direction is strictly one-way:
the SDK and the runtime both depend on this contract; this contract depends on
nothing.

> Most merchants never install this package directly — it comes in transitively
> through [`@sunbay/checkout-sdk-js`](https://www.npmjs.com/package/@sunbay/checkout-sdk-js).
> Install it explicitly only when you need the protocol types in your own
> TypeScript code.

## Install

```bash
npm install @sunbay/checkout-sdk-protocol
```

## What it exports

| Area | Exports |
| --- | --- |
| **Envelope** | `PROTOCOL_NAME`, `PROTOCOL_MAJOR`, `encodeEnvelope`, `decodeEnvelope`, `EnvelopeDecodeError`, `Envelope`, `RuntimeHello` |
| **Errors** | `ErrorCode`, `ErrorCodeValue` |
| **Commands** | `COMMAND_NAMES`, `isCommandName`, and the request/response type maps (`CommandRequestMap`, `CommandResponseMap`) plus per-command types (`InitializeReq/Resp`, `ConfirmReq/Resp`, `CreateElementReq/Resp`, …) |
| **Events** | `EVENT_NAMES`, `isEventName`, `EventPayloadMap`, and per-event payload types (`PaymentResultEvent`, `ChangeEvent`, `ExpressAvailabilityChangeEvent`, …) |
| **Data shapes** | `PublicSessionView`, `PaymentOutcome`, `PaymentMethod`, `Appearance`, `ElementType`, `ElementOptions`, `AddressInfo`, `TxnStatus`, and related types |
| **Iframe layout** | `IFRAME_RESIZE_MESSAGE_TYPE`, `isIframeResizeMessage`, `IframeResizeMessage` |

See the type declarations shipped in the package (`dist/index.d.ts`) for the
full, authoritative contract.

## Versioning

The protocol and the JS SDK are released **in lockstep** — they always share the
same version number. When the protocol changes, both packages are republished
together so a given `@sunbay/checkout-sdk-js` always pairs with the matching
`@sunbay/checkout-sdk-protocol`.
