/**
 * 信封与握手契约（spec 5.1，真源）。
 *
 * 协议名 `sunbay-checkout`，`major = 1`。与现有 Native Bridge `{v:1,type,...}`
 * 是不同协议，数字相同不代表兼容。
 *
 * `encodeEnvelope`/`decodeEnvelope`：JSON 序列化 + 最小运行时结构校验
 * （校验 protocol/major/kind/必填字段），非法抛错。解码器**不**校验 request.name
 * 是否为已知 CommandName —— 未知 name 仍解为 kind==='request'，由调用方拒绝。
 */

import type { CheckoutError } from './types';

/** 协议名常量。 */
export const PROTOCOL_NAME = 'sunbay-checkout' as const;
/** 当前主版本。 */
export const PROTOCOL_MAJOR = 1 as const;

/**
 * 握手消息（spec 5.1）。main iframe 加载后先广播，此时尚无 checkoutId。
 */
export type RuntimeHello = {
    protocol: 'sunbay-checkout';
    kind: 'hello';
    runtimeId: string;
    supportedMajorVersions: number[];
    /** 首期：['card','splitCard','address','express','paymentMethodFilter']。 */
    capabilities: string[];
};

/**
 * 初始化后的公共信封（spec 5.1）。
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

/** 合法 kind 集合。 */
const ENVELOPE_KINDS = ['request', 'response', 'event'] as const;

/** 协议校验失败错误。 */
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
 * 将信封序列化为线缆字符串（JSON）。
 *
 * @param envelope 待发送的信封
 * @returns JSON 字符串
 * @example
 * const wire = encodeEnvelope({ protocol: 'sunbay-checkout', major: 1, ... });
 */
export function encodeEnvelope(envelope: Envelope): string {
    return JSON.stringify(envelope);
}

/**
 * 解析并最小结构校验信封。非法（缺 protocol、错 major、非法 kind、缺必填字段、
 * 非 JSON）一律抛 {@link EnvelopeDecodeError}。
 *
 * 注意：解码器不校验 request.name 是否为已知命令 —— 未知 name 仍解为
 * kind==='request'，交由调用方（如 Orchestrator）拒绝。
 *
 * @param wire 线缆字符串
 * @returns 已校验结构的信封
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

    // 结构已校验，确认为 Envelope 形状。
    return parsed as unknown as Envelope;
}
