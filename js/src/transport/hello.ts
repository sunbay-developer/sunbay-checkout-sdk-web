/**
 * RuntimeHello shape validation shared by the transport and the createCheckout handshake.
 *
 * A hello that fails validation is ignored (never throws), so a malformed or hostile message can
 * neither crash the handshake with a raw TypeError nor consume the one-shot hello slot.
 */

import { PROTOCOL_NAME, type RuntimeHello } from '@sunbay/checkout-sdk-protocol';

/**
 * Check that a value is a well-formed RuntimeHello.
 *
 * Requires `runtimeId` to be a non-empty string and `supportedMajorVersions` to be an array of
 * finite numbers. `capabilities` is optional, but when present it must be an array of strings.
 *
 * @param value - Unknown parsed message.
 * @returns Whether the value is a valid RuntimeHello.
 */
export function isValidRuntimeHello(value: unknown): value is RuntimeHello {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const r = value as Record<string, unknown>;
    if (r.protocol !== PROTOCOL_NAME || r.kind !== 'hello') {
        return false;
    }
    if (typeof r.runtimeId !== 'string' || r.runtimeId.length === 0) {
        return false;
    }
    if (
        !Array.isArray(r.supportedMajorVersions) ||
        !r.supportedMajorVersions.every((v) => typeof v === 'number' && Number.isFinite(v))
    ) {
        return false;
    }
    if (
        r.capabilities !== undefined &&
        (!Array.isArray(r.capabilities) || !r.capabilities.every((c) => typeof c === 'string'))
    ) {
        return false;
    }
    return true;
}
