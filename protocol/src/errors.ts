/**
 * Protocol error code constants (single source of truth, spec 5.4).
 *
 * Does not provide a generic `retryable` boolean that could mislead into duplicate payments.
 * Only keeps error codes that are actually produced; new codes must have a production point.
 */

export const ErrorCode = {
    INVALID_OPTIONS: 'INVALID_OPTIONS',
    ELEMENT_CONFLICT: 'ELEMENT_CONFLICT',
    INSTANCE_DESTROYED: 'INSTANCE_DESTROYED',
    CHECKOUT_BUSY: 'CHECKOUT_BUSY',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    SESSION_LOAD_FAILED: 'SESSION_LOAD_FAILED',
    RUNTIME_LOAD_FAILED: 'RUNTIME_LOAD_FAILED',
    PROTOCOL_UNSUPPORTED: 'PROTOCOL_UNSUPPORTED',
    REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
    PAYMENT_FLOW_ERROR: 'PAYMENT_FLOW_ERROR',
    UNSUPPORTED_CAPABILITY: 'UNSUPPORTED_CAPABILITY',
} as const;

/** Error code literal union type. */
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
