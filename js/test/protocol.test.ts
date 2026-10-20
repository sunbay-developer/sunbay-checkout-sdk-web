import { describe, expect, it } from 'vitest';
import {
    decodeEnvelope,
    encodeEnvelope,
    ErrorCode,
    type Envelope,
} from '@sunbay/checkout-sdk-protocol';

/**
 * 协议契约测试（真源：protocol/src）。
 * 覆盖：encode/decode 往返相等、缺字段校验、未知 name 的 request 由调用方拒、错误码常量。
 */
describe('protocol envelope', () => {
    const baseRequest: Envelope = {
        protocol: 'sunbay-checkout',
        major: 1,
        runtimeId: 'rt_1',
        checkoutId: 'co_1',
        kind: 'request',
        requestId: 'req_1',
        name: 'initialize',
        payload: { sessionId: 'sess_1', locale: 'en' },
    };

    it('decodeEnvelope(encodeEnvelope(req)) 往返相等', () => {
        const wire = encodeEnvelope(baseRequest);
        expect(typeof wire).toBe('string');
        const decoded = decodeEnvelope(wire);
        expect(decoded).toEqual(baseRequest);
    });

    it('response/event 信封同样往返相等', () => {
        const okResponse: Envelope = {
            protocol: 'sunbay-checkout',
            major: 1,
            runtimeId: 'rt_1',
            checkoutId: 'co_1',
            kind: 'response',
            requestId: 'req_1',
            ok: true,
            data: { capabilities: ['card'] },
        };
        expect(decodeEnvelope(encodeEnvelope(okResponse))).toEqual(okResponse);

        const event: Envelope = {
            protocol: 'sunbay-checkout',
            major: 1,
            runtimeId: 'rt_1',
            checkoutId: 'co_1',
            kind: 'event',
            eventId: 'evt_1',
            name: 'ready',
            payload: { elementId: 'el_1' },
        };
        expect(decodeEnvelope(encodeEnvelope(event))).toEqual(event);
    });

    it('缺 protocol 字段抛错', () => {
        const bad = JSON.stringify({
            major: 1,
            runtimeId: 'rt_1',
            checkoutId: 'co_1',
            kind: 'request',
            requestId: 'req_1',
            name: 'initialize',
            payload: {},
        });
        expect(() => decodeEnvelope(bad)).toThrow();
    });

    it('错误 protocol 值抛错', () => {
        const bad = JSON.stringify({ ...baseRequest, protocol: 'not-sunbay' });
        expect(() => decodeEnvelope(bad)).toThrow();
    });

    it('错误 major 抛错', () => {
        const bad = JSON.stringify({ ...baseRequest, major: 2 });
        expect(() => decodeEnvelope(bad)).toThrow();
    });

    it('非法 kind 抛错', () => {
        const bad = JSON.stringify({ ...baseRequest, kind: 'bogus' });
        expect(() => decodeEnvelope(bad)).toThrow();
    });

    it('request 缺必填 name 抛错', () => {
        const bad = JSON.stringify({
            protocol: 'sunbay-checkout',
            major: 1,
            runtimeId: 'rt_1',
            checkoutId: 'co_1',
            kind: 'request',
            requestId: 'req_1',
            payload: {},
        });
        expect(() => decodeEnvelope(bad)).toThrow();
    });

    it('非 JSON 字符串抛错', () => {
        expect(() => decodeEnvelope('{not json')).toThrow();
    });

    it("未知 name 的 request 解出后 kind==='request'（由调用方拒绝）", () => {
        const unknown: Envelope = {
            protocol: 'sunbay-checkout',
            major: 1,
            runtimeId: 'rt_1',
            checkoutId: 'co_1',
            kind: 'request',
            requestId: 'req_x',
            name: 'totallyUnknownCommand',
            payload: {},
        };
        const decoded = decodeEnvelope(encodeEnvelope(unknown));
        expect(decoded.kind).toBe('request');
        // 解码器不校验 name 是否为已知 CommandName —— 交由调用方（Orchestrator）拒绝。
        if (decoded.kind === 'request') {
            expect(decoded.name).toBe('totallyUnknownCommand');
        }
    });
});

describe('protocol error codes', () => {
    it("ErrorCode.CHECKOUT_BUSY === 'CHECKOUT_BUSY'", () => {
        expect(ErrorCode.CHECKOUT_BUSY).toBe('CHECKOUT_BUSY');
    });

    it('错误码常量全集存在且值自等', () => {
        const codes = [
            'INVALID_OPTIONS',
            'ELEMENT_CONFLICT',
            'INSTANCE_DESTROYED',
            'CHECKOUT_BUSY',
            'VALIDATION_ERROR',
            'SESSION_LOAD_FAILED',
            'RUNTIME_LOAD_FAILED',
            'PROTOCOL_UNSUPPORTED',
            'REQUEST_TIMEOUT',
            'PAYMENT_FLOW_ERROR',
            'UNSUPPORTED_CAPABILITY',
        ] as const;
        for (const c of codes) {
            expect(ErrorCode[c]).toBe(c);
        }
    });
});

/**
 * expressCheckout 协议补充契约测试（真源：protocol/src）。
 * 覆盖：ExpressCheckoutElementOptions 精确结构可编解码；AvailableWallets 存在；
 * express 可用性事件载荷含 applePay/googlePay 布尔。
 */
import { EVENT_NAMES, isEventName } from '@sunbay/checkout-sdk-protocol';
import type {
    AvailableWallets,
    EventName,
    EventPayloadMap,
    ExpressAvailabilityChangeEvent,
    ExpressCheckoutElementOptions,
    ElementReadyEvent,
} from '@sunbay/checkout-sdk-protocol';

describe('protocol expressCheckout options', () => {
    it('ExpressCheckoutElementOptions 精确结构可编解码往返相等', () => {
        const opts: ExpressCheckoutElementOptions = {
            paymentMethods: { applePay: true, googlePay: false },
            layout: { maxColumns: 2 },
            buttonTheme: { applePay: 'black', googlePay: 'white' },
            buttonHeight: 48,
        };
        const wire = JSON.stringify(opts);
        const decoded = JSON.parse(wire) as ExpressCheckoutElementOptions;
        expect(decoded).toEqual(opts);
        expect(decoded.paymentMethods?.applePay).toBe(true);
        expect(decoded.paymentMethods?.googlePay).toBe(false);
        expect(decoded.layout?.maxColumns).toBe(2);
        expect(decoded.buttonTheme?.applePay).toBe('black');
        expect(decoded.buttonHeight).toBe(48);
    });

    it('ExpressCheckoutElementOptions 允许全部字段省略（向后兼容）', () => {
        const opts: ExpressCheckoutElementOptions = {};
        expect(JSON.parse(JSON.stringify(opts))).toEqual(opts);
    });
});

describe('protocol available wallets event', () => {
    it('AvailableWallets 含 applePay/googlePay 布尔', () => {
        const wallets: AvailableWallets = { applePay: true, googlePay: false };
        const decoded = JSON.parse(JSON.stringify(wallets)) as AvailableWallets;
        expect(typeof decoded.applePay).toBe('boolean');
        expect(typeof decoded.googlePay).toBe('boolean');
        expect(decoded.applePay).toBe(true);
        expect(decoded.googlePay).toBe(false);
    });

    it('ExpressAvailabilityChangeEvent 载荷含 availableWallets', () => {
        const evt: ExpressAvailabilityChangeEvent = {
            availableWallets: { applePay: false, googlePay: true },
        };
        const decoded = JSON.parse(JSON.stringify(evt)) as ExpressAvailabilityChangeEvent;
        expect(decoded.availableWallets.applePay).toBe(false);
        expect(decoded.availableWallets.googlePay).toBe(true);
    });

    it('ElementReadyEvent 可携带可选 availableWallets: AvailableWallets', () => {
        const evt: ElementReadyEvent = {
            elementId: 'el_express',
            availableWallets: { applePay: true, googlePay: true },
        };
        const decoded = JSON.parse(JSON.stringify(evt)) as ElementReadyEvent;
        expect(decoded.availableWallets?.applePay).toBe(true);
        expect(decoded.availableWallets?.googlePay).toBe(true);
    });
});

/**
 * expressCheckout 可用性事件登记契约（W1 + M1）。
 * 覆盖：'expressAvailabilityChange' 属于 EventName 且在 EVENT_NAMES；
 * EventPayloadMap['expressAvailabilityChange'] 为 ExpressAvailabilityChangeEvent；
 * ElementReadyEvent 与事件统一使用 availableWallets 字段。
 */
describe('protocol express availability event registration', () => {
    it("'expressAvailabilityChange' 在 EVENT_NAMES 且被 isEventName 识别", () => {
        expect(EVENT_NAMES).toContain('expressAvailabilityChange');
        expect(isEventName('expressAvailabilityChange')).toBe(true);
    });

    it("'expressAvailabilityChange' 属于 EventName 联合类型", () => {
        const name: EventName = 'expressAvailabilityChange';
        expect(name).toBe('expressAvailabilityChange');
    });

    it("EventPayloadMap['expressAvailabilityChange'] 为 ExpressAvailabilityChangeEvent", () => {
        const payload: EventPayloadMap['expressAvailabilityChange'] = {
            availableWallets: { applePay: true, googlePay: false },
        };
        // 类型等价断言：同一引用可互赋，证明映射值即 ExpressAvailabilityChangeEvent。
        const asEvent: ExpressAvailabilityChangeEvent = payload;
        const asPayload: EventPayloadMap['expressAvailabilityChange'] = asEvent;
        expect(asPayload.availableWallets.applePay).toBe(true);
        expect(asPayload.availableWallets.googlePay).toBe(false);
    });

    it('EventPayloadMap.elementReady.availableWallets 可选存在', () => {
        const payload: EventPayloadMap['elementReady'] = {
            elementId: 'el_express',
            availableWallets: { applePay: false, googlePay: true },
        };
        expect(payload.availableWallets?.applePay).toBe(false);
        expect(payload.availableWallets?.googlePay).toBe(true);
    });
});
