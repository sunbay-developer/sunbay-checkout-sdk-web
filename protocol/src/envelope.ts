/**
 * Envelope and handshake contract (spec 5.1, source of truth).
 *
 * Protocol name `sunbay-checkout`, `major = 1`. This is a different protocol from the existing
 * Native Bridge `{v:1,type,...}`; identical numbers do not imply compatibility.
 *
 * `encodeEnvelope`/`decodeEnvelope`: JSON serialization + minimal runtime structural validation
 * (validates protocol/major/kind/required fields), throwing on invalid input. The decoder does
 * **not** validate whether request.name is a known CommandName — an unknown name is still decoded
 * as kind==='request' and rejected by the caller.
 */

import type { CheckoutError } from './types';

/** Protocol name constant. */
export const PROTOCOL_NAME = 'sunbay-checkout' as const;
/** Current major version. */
export const PROTOCOL_MAJOR = 1 as const;

/**
 * Handshake message (spec 5.1). Broadcast first after the main iframe loads, when there is no
 * checkoutId yet.
 */
export type RuntimeHello = {
    protocol: 'sunbay-checkout';
    kind: 'hello';
    runtimeId: string;
    supportedMajorVersions: number[];
    /** First phase: ['card','splitCard','address','express','paymentMethodFilter']. */
    capabilities: string[];
};

/**
 * Public envelope after initialization (spec 5.1).
 */
export type Envelope = {
    protocol: 'sunbay-checkout';
    major: 1;
    runtimeId: string;
    checkoutId: string;
    elementId?: string;
} & (
    | { kind: 'request'; requestId: string; name: string; payload: unknown }
    | { kind: 'response'; requestId: string; ok: true; data: unknown }
    | { kind: 'response'; requestId: string; ok: false; error: CheckoutError }
    | { kind: 'event'; eventId: string; name: string; operationId?: string; payload: unknown }
);

/** Set of valid kinds. */
const ENVELOPE_KINDS = ['request', 'response', 'event'] as const;

/** Protocol validation failure error. */
export class EnvelopeDecodeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'EnvelopeDecodeError';
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function assertString(obj: Record<string, unknown>, key: string): void {
    if (typeof obj[key] !== 'string') {
        throw new EnvelopeDecodeError(`Envelope field "${key}" is missing or not a string`);
    }
}

/**
 * Serialize an envelope into a wire string (JSON).
 *
 * @param envelope The envelope to send
 * @returns JSON string
 * @example
 * const wire = encodeEnvelope({ protocol: 'sunbay-checkout', major: 1, ... });
 */
export function encodeEnvelope(envelope: Envelope): string {
    return JSON.stringify(envelope);
}

/**
 * Parse and minimally structurally validate an envelope. Invalid input (missing protocol, wrong
 * major, invalid kind, missing required fields, non-JSON) always throws {@link EnvelopeDecodeError}.
 *
 * Note: the decoder does not validate whether request.name is a known command — an unknown name is
 * still decoded as kind==='request' and left for the caller (e.g. the Orchestrator) to reject.
 *
 * @param wire The wire string
 * @returns The structurally validated envelope
 * @example
 * const env = decodeEnvelope(wire);
 * if (env.kind === 'request') { ... }
 */
export function decodeEnvelope(wire: string): Envelope {
    let parsed: unknown;
    try {
        parsed = JSON.parse(wire);
    } catch {
        throw new EnvelopeDecodeError('Envelope is not valid JSON');
    }

    if (!isRecord(parsed)) {
        throw new EnvelopeDecodeError('Envelope must be an object');
    }

    if (parsed.protocol !== PROTOCOL_NAME) {
        throw new EnvelopeDecodeError(
            `protocol must be "${PROTOCOL_NAME}", received ${JSON.stringify(parsed.protocol)}`
        );
    }
    if (parsed.major !== PROTOCOL_MAJOR) {
        throw new EnvelopeDecodeError(
            `major must be ${PROTOCOL_MAJOR}, received ${JSON.stringify(parsed.major)}`
        );
    }

    assertString(parsed, 'runtimeId');
    assertString(parsed, 'checkoutId');
    if (parsed.elementId !== undefined && typeof parsed.elementId !== 'string') {
        throw new EnvelopeDecodeError('elementId must be a string when present');
    }

    const kind = parsed.kind;
    if (typeof kind !== 'string' || !(ENVELOPE_KINDS as readonly string[]).includes(kind)) {
        throw new EnvelopeDecodeError(`Invalid kind: ${JSON.stringify(kind)}`);
    }

    switch (kind) {
        case 'request': {
            assertString(parsed, 'requestId');
            assertString(parsed, 'name');
            if (!('payload' in parsed)) {
                throw new EnvelopeDecodeError('request envelope is missing payload');
            }
            break;
        }
        case 'response': {
            assertString(parsed, 'requestId');
            if (typeof parsed.ok !== 'boolean') {
                throw new EnvelopeDecodeError('response envelope is missing boolean ok');
            }
            if (parsed.ok === true) {
                if (!('data' in parsed)) {
                    throw new EnvelopeDecodeError('successful response is missing data');
                }
            } else if (!isRecord(parsed.error)) {
                throw new EnvelopeDecodeError('failed response is missing error object');
            }
            break;
        }
        case 'event': {
            assertString(parsed, 'eventId');
            assertString(parsed, 'name');
            if (!('payload' in parsed)) {
                throw new EnvelopeDecodeError('event envelope is missing payload');
            }
            if (
                'operationId' in parsed &&
                parsed.operationId !== undefined &&
                typeof parsed.operationId !== 'string'
            ) {
                throw new EnvelopeDecodeError('operationId must be a string when present');
            }
            break;
        }
    }

    // Structure validated; confirmed to be an Envelope shape.
    return parsed as unknown as Envelope;
}
