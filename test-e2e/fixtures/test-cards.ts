/**
 * Sandbox test cards for real-device (e2e) functional tests.
 *
 * These are SANDBOX-ONLY, publicly shareable test credentials used purely for
 * functional verification of the checkout flow. They do NOT correspond to real
 * cards and never settle real money, so storing them in plaintext here is safe.
 *
 * PCI boundary reminder: card values must NEVER travel through the SDK, the
 * parent window, or any postMessage channel. In tests, these values are typed
 * DIRECTLY into the hosted card-field iframes (cardNumber / cardExpiry /
 * cardCvc) by the browser automation layer. The SDK only relays
 * protocol envelopes and never sees the card value.
 *
 * @see ../harness-design.md §5 (cross-iframe card entry convention)
 * @see ../README.md §1 (PCI invariant)
 */

/** A single card's data split into the fields hosted card inputs expect. */
export interface SandboxCard {
    /** Primary account number (digits only; formatting is applied inside the field). */
    cardNumber: string;
    /** Expiry month, two digits, '01'–'12'. */
    expiryMonth: string;
    /** Expiry year, four digits. */
    expiryYear: string;
    /** Card verification value. */
    cvv: string;
}

/**
 * Default sandbox card for the happy-path payment flow (C7-01).
 *
 * Expected sandbox outcome: a terminal `paymentResult` (typically `succeeded`).
 * Used by typing its fields directly into the hosted card-field iframes.
 */
export const SANDBOX_CARD_DEFAULT: SandboxCard = {
    cardNumber: '4012000098765439',
    expiryMonth: '12',
    expiryYear: '2028',
    cvv: '999',
};

/**
 * A syntactically invalid card number used ONLY to exercise the field's
 * validation/`invalid` visual state (e.g. C5-02 input:invalid styling, C7-03
 * change event with complete:false). It fails the Luhn check and must NOT be
 * used for the payment flow, to avoid confusion with the real sandbox card.
 *
 * This is deliberately a bogus number, not a sandbox-issued card.
 */
export const INVALID_CARD_NUMBER = '4111111111111112';

/**
 * All sandbox cards, keyed by a stable id for test-case references.
 * Extend this map when additional sandbox scenarios (declined, 3DS, etc.) are
 * provided by the sandbox merchant.
 */
export const SANDBOX_CARDS: Record<string, SandboxCard> = {
    default: SANDBOX_CARD_DEFAULT,
};
