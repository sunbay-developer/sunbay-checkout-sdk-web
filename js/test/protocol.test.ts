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
    Appearance,
    AppearanceVariables,
    AppearanceRuleTarget,
    AppearanceRuleStyle,
    AvailableWallets,
    EventName,
    EventPayloadMap,
    ExpressAvailabilityChangeEvent,
    ExpressCheckoutElementOptions,
    ElementReadyEvent,
} from '@sunbay/checkout-sdk-protocol';

/**
 * Appearance.colorScheme 协议契约测试（真源：protocol/src）。
 * 覆盖：带 colorScheme:'dark' 的 Appearance 类型检查通过且 JSON 往返保留 colorScheme；
 * 'light' | 'dark' | 'auto' 三值合法；colorScheme 可省略（向后兼容）。
 */
describe('protocol Appearance colorScheme', () => {
    it("带 colorScheme:'dark' 的 Appearance 类型检查通过且 JSON 往返保留 colorScheme", () => {
        const appearance: Appearance = {
            variables: { colorPrimary: '#000' },
            colorScheme: 'dark',
        };
        const decoded = JSON.parse(JSON.stringify(appearance)) as Appearance;
        expect(decoded).toEqual(appearance);
        expect(decoded.colorScheme).toBe('dark');
    });

    it("colorScheme 接受 'light' | 'dark' | 'auto' 三值", () => {
        const schemes = ['light', 'dark', 'auto'] as const;
        for (const scheme of schemes) {
            const appearance: Appearance = { colorScheme: scheme };
            const decoded = JSON.parse(JSON.stringify(appearance)) as Appearance;
            expect(decoded.colorScheme).toBe(scheme);
        }
    });

    it('colorScheme 可省略（向后兼容）', () => {
        const appearance: Appearance = { variables: { colorPrimary: '#000' } };
        const decoded = JSON.parse(JSON.stringify(appearance)) as Appearance;
        expect(decoded).toEqual(appearance);
        expect(decoded.colorScheme).toBeUndefined();
    });
});

describe('protocol expressCheckout options', () => {
    it('ExpressCheckoutElementOptions 精确结构可编解码往返相等', () => {
        const opts: ExpressCheckoutElementOptions = {
            paymentMethods: { applePay: true, googlePay: false },
            layout: { maxColumns: 2 },
            buttonHeight: 48,
        };
        const wire = JSON.stringify(opts);
        const decoded = JSON.parse(wire) as ExpressCheckoutElementOptions;
        expect(decoded).toEqual(opts);
        expect(decoded.paymentMethods?.applePay).toBe(true);
        expect(decoded.paymentMethods?.googlePay).toBe(false);
        expect(decoded.layout?.maxColumns).toBe(2);
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

import {
    IFRAME_RESIZE_MESSAGE_TYPE,
    isIframeResizeMessage,
    type IframeResizeMessage,
} from '@sunbay/checkout-sdk-protocol';

describe('isIframeResizeMessage (iframe auto-resize contract)', () => {
    const valid: IframeResizeMessage = {
        type: IFRAME_RESIZE_MESSAGE_TYPE,
        elementId: 'el_1',
        height: 42,
    };

    it('接受合法消息(type/elementId/height 齐备)', () => {
        expect(isIframeResizeMessage(valid)).toBe(true);
    });

    it('接受 height=0(边界,非负有限)', () => {
        expect(isIframeResizeMessage({ ...valid, height: 0 })).toBe(true);
    });

    it('拒绝 type 不匹配', () => {
        expect(isIframeResizeMessage({ ...valid, type: 'other' })).toBe(false);
    });

    it('拒绝 elementId 空串 / 非字符串', () => {
        expect(isIframeResizeMessage({ ...valid, elementId: '' })).toBe(false);
        expect(isIframeResizeMessage({ ...valid, elementId: 123 })).toBe(false);
    });

    it('拒绝 height 非有限 / 负数 / 非数字', () => {
        expect(isIframeResizeMessage({ ...valid, height: Infinity })).toBe(false);
        expect(isIframeResizeMessage({ ...valid, height: -1 })).toBe(false);
        expect(isIframeResizeMessage({ ...valid, height: '42' })).toBe(false);
    });

    it('拒绝非对象 / null', () => {
        expect(isIframeResizeMessage(null)).toBe(false);
        expect(isIframeResizeMessage('x')).toBe(false);
        expect(isIframeResizeMessage(undefined)).toBe(false);
    });
});

/**
 * expressCheckout 每钱包配置契约（钱包按钮主题跟随 Task 1）。
 * 覆盖：paymentMethods.{applePay,googlePay} 为 `boolean | 对应 Options`；
 * ApplePayOptions/GooglePayOptions.buttonTheme 为白名单联合字面量；四个新符号已从协议包导出。
 */
import type {
    ApplePayButtonTheme,
    ApplePayOptions,
    GooglePayButtonTheme,
    GooglePayOptions,
} from '@sunbay/checkout-sdk-protocol';

describe('protocol expressCheckout per-wallet options', () => {
    it('paymentMethods 接受「布尔 | 配置对象」混合形状', () => {
        const a: ExpressCheckoutElementOptions = {
            paymentMethods: { applePay: false, googlePay: { buttonTheme: 'white' } },
        };
        const b: ExpressCheckoutElementOptions = {
            paymentMethods: { applePay: true, googlePay: { buttonTheme: 'default' } },
        };
        expect(a).toBeDefined();
        expect(b).toBeDefined();
        const decodedA = JSON.parse(JSON.stringify(a)) as ExpressCheckoutElementOptions;
        const decodedB = JSON.parse(JSON.stringify(b)) as ExpressCheckoutElementOptions;
        expect(decodedA).toEqual(a);
        expect(decodedB).toEqual(b);
    });

    it('ApplePayButtonTheme 接受 black | white | white-outline', () => {
        const themes: ApplePayButtonTheme[] = ['black', 'white', 'white-outline'];
        for (const buttonTheme of themes) {
            const opts: ApplePayOptions = { buttonTheme };
            expect(opts.buttonTheme).toBe(buttonTheme);
        }
    });

    it('GooglePayButtonTheme 接受 black | white | default', () => {
        const themes: GooglePayButtonTheme[] = ['black', 'white', 'default'];
        for (const buttonTheme of themes) {
            const opts: GooglePayOptions = { buttonTheme };
            expect(opts.buttonTheme).toBe(buttonTheme);
        }
    });

    it('ApplePayOptions/GooglePayOptions 可省略 buttonTheme', () => {
        const apple: ApplePayOptions = {};
        const google: GooglePayOptions = {};
        expect(apple.buttonTheme).toBeUndefined();
        expect(google.buttonTheme).toBeUndefined();
    });
});

describe('protocol appearance variables + rules', () => {
    it('Appearance 接受白名单 variables + rules + colorScheme', () => {
        const variables: AppearanceVariables = {
            colorPrimary: '#3366ff',
            borderRadius: '8px',
            fontFamily: 'Inter, sans-serif',
        };
        const rules: NonNullable<Appearance['rules']> = {
            input: { color: '#111111' },
            'input:focus': { 'border-color': '#3366ff' },
            cardBrand: { opacity: '0.8' },
        };
        const appearance: Appearance = { variables, rules, colorScheme: 'auto' };
        expect(appearance).toBeDefined();
        expect(appearance.variables).toBe(variables);
        expect(appearance.rules).toBe(rules);
        expect(appearance.colorScheme).toBe('auto');
    });

    it('AppearanceRuleTarget 覆盖 7 个语义锚点', () => {
        const targets: AppearanceRuleTarget[] = [
            'input',
            'input:focus',
            'input:invalid',
            'label',
            'error',
            'cardBrand',
            'cvvIcon',
        ];
        expect(targets).toHaveLength(7);
    });

    it('AppearanceRuleStyle 为属性名到值的开放映射', () => {
        const style: AppearanceRuleStyle = { color: '#000', 'border-radius': '4px' };
        expect(style.color).toBe('#000');
    });

    it('非白名单 rule target 应被类型层拒绝', () => {
        const appearance: Appearance = {
            // @ts-expect-error body 不是合法的 AppearanceRuleTarget
            rules: { body: {} },
        };
        expect(appearance).toBeDefined();
    });
});

/**
 * expressCheckout 钱包按钮 buttonType + buttonHeight 契约（Task 1）。
 * 覆盖：ApplePayButtonType（14 项官方全集）/ GooglePayButtonType（8 项）为白名单联合字面量；
 * ApplePayOptions/GooglePayOptions.buttonType 可赋合法值、非法值被类型层拒；
 * ExpressCheckoutElementOptions.buttonHeight 与每钱包 buttonType 组合可往返。
 */
import type {
    ApplePayButtonType,
    GooglePayButtonType,
} from '@sunbay/checkout-sdk-protocol';

describe('protocol expressCheckout buttonType + buttonHeight', () => {
    it('ApplePayButtonType 接受 14 项官方全集', () => {
        const types: ApplePayButtonType[] = [
            'plain',
            'buy',
            'donate',
            'check-out',
            'book',
            'subscribe',
            'reload',
            'add-money',
            'top-up',
            'order',
            'rent',
            'support',
            'contribute',
            'tip',
        ];
        expect(types).toHaveLength(14);
    });

    it('GooglePayButtonType 接受 8 项官方全集', () => {
        const types: GooglePayButtonType[] = [
            'buy',
            'plain',
            'checkout',
            'pay',
            'donate',
            'book',
            'order',
            'subscribe',
        ];
        expect(types).toHaveLength(8);
    });

    it('每钱包 buttonType + 全局 buttonHeight 组合可赋值并往返相等', () => {
        const opts: ExpressCheckoutElementOptions = {
            paymentMethods: {
                applePay: { buttonType: 'buy' },
                googlePay: { buttonType: 'checkout' },
            },
            buttonHeight: 48,
        };
        const decoded = JSON.parse(JSON.stringify(opts)) as ExpressCheckoutElementOptions;
        expect(decoded).toEqual(opts);
        expect(decoded.buttonHeight).toBe(48);
    });

    it('ApplePayOptions/GooglePayOptions 可省略 buttonType（向后兼容）', () => {
        const apple: ApplePayOptions = {};
        const google: GooglePayOptions = {};
        expect(apple.buttonType).toBeUndefined();
        expect(google.buttonType).toBeUndefined();
    });

    it('非法 applePay buttonType 应被类型层拒绝', () => {
        const opts: ExpressCheckoutElementOptions = {
            paymentMethods: {
                // @ts-expect-error 'nope' 不是合法的 ApplePayButtonType
                applePay: { buttonType: 'nope' },
            },
        };
        expect(opts).toBeDefined();
    });

    it('非法 googlePay buttonType 应被类型层拒绝', () => {
        const opts: ExpressCheckoutElementOptions = {
            paymentMethods: {
                // @ts-expect-error 'pay-now' 不是合法的 GooglePayButtonType
                googlePay: { buttonType: 'pay-now' },
            },
        };
        expect(opts).toBeDefined();
    });
});
