import { describe, expect, it } from 'vitest';
import {
    decodeEnvelope,
    encodeEnvelope,
    ErrorCode,
    type Envelope,
} from '@sunbay/checkout-sdk-protocol';

/**
 * Protocol contract tests (source of truth: protocol/src).
 * Covers: encode/decode round-trip equality, missing-field validation, request with unknown name
 * rejected by the caller, error code constants.
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

    it('decodeEnvelope(encodeEnvelope(req)) round-trips equal', () => {
        const wire = encodeEnvelope(baseRequest);
        expect(typeof wire).toBe('string');
        const decoded = decodeEnvelope(wire);
        expect(decoded).toEqual(baseRequest);
    });

    it('response/event envelopes round-trip equal too', () => {
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

    it('throws when protocol field is missing', () => {
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

    it('throws on wrong protocol value', () => {
        const bad = JSON.stringify({ ...baseRequest, protocol: 'not-sunbay' });
        expect(() => decodeEnvelope(bad)).toThrow();
    });

    it('throws on wrong major', () => {
        const bad = JSON.stringify({ ...baseRequest, major: 2 });
        expect(() => decodeEnvelope(bad)).toThrow();
    });

    it('throws on invalid kind', () => {
        const bad = JSON.stringify({ ...baseRequest, kind: 'bogus' });
        expect(() => decodeEnvelope(bad)).toThrow();
    });

    it('throws when request is missing required name', () => {
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

    it('throws on non-JSON string', () => {
        expect(() => decodeEnvelope('{not json')).toThrow();
    });

    it("request with unknown name decodes to kind==='request' (rejected by the caller)", () => {
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
        // The decoder does not validate whether name is a known CommandName — that is left to the
        // caller (Orchestrator) to reject.
        if (decoded.kind === 'request') {
            expect(decoded.name).toBe('totallyUnknownCommand');
        }
    });
});

describe('protocol error codes', () => {
    it("ErrorCode.CHECKOUT_BUSY === 'CHECKOUT_BUSY'", () => {
        expect(ErrorCode.CHECKOUT_BUSY).toBe('CHECKOUT_BUSY');
    });

    it('all error code constants exist and are self-equal', () => {
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
 * expressCheckout protocol supplementary contract tests (source of truth: protocol/src).
 * Covers: ExpressCheckoutElementOptions exact structure encodes/decodes; AvailableWallets exists;
 * express availability event payload contains applePay/googlePay booleans.
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
 * Appearance.colorScheme protocol contract tests (source of truth: protocol/src).
 * Covers: Appearance with colorScheme:'dark' type-checks and JSON round-trip preserves colorScheme;
 * 'light' | 'dark' | 'auto' are all valid; colorScheme may be omitted (backward compatible).
 */
describe('protocol Appearance colorScheme', () => {
    it("Appearance with colorScheme:'dark' type-checks and JSON round-trip preserves colorScheme", () => {
        const appearance: Appearance = {
            variables: { colorPrimary: '#000' },
            colorScheme: 'dark',
        };
        const decoded = JSON.parse(JSON.stringify(appearance)) as Appearance;
        expect(decoded).toEqual(appearance);
        expect(decoded.colorScheme).toBe('dark');
    });

    it("colorScheme accepts the three values 'light' | 'dark' | 'auto'", () => {
        const schemes = ['light', 'dark', 'auto'] as const;
        for (const scheme of schemes) {
            const appearance: Appearance = { colorScheme: scheme };
            const decoded = JSON.parse(JSON.stringify(appearance)) as Appearance;
            expect(decoded.colorScheme).toBe(scheme);
        }
    });

    it('colorScheme may be omitted (backward compatible)', () => {
        const appearance: Appearance = { variables: { colorPrimary: '#000' } };
        const decoded = JSON.parse(JSON.stringify(appearance)) as Appearance;
        expect(decoded).toEqual(appearance);
        expect(decoded.colorScheme).toBeUndefined();
    });
});

describe('protocol expressCheckout options', () => {
    it('ExpressCheckoutElementOptions exact structure encodes/decodes round-trip equal', () => {
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

    it('ExpressCheckoutElementOptions allows all fields omitted (backward compatible)', () => {
        const opts: ExpressCheckoutElementOptions = {};
        expect(JSON.parse(JSON.stringify(opts))).toEqual(opts);
    });
});

describe('protocol available wallets event', () => {
    it('AvailableWallets contains applePay/googlePay booleans', () => {
        const wallets: AvailableWallets = { applePay: true, googlePay: false };
        const decoded = JSON.parse(JSON.stringify(wallets)) as AvailableWallets;
        expect(typeof decoded.applePay).toBe('boolean');
        expect(typeof decoded.googlePay).toBe('boolean');
        expect(decoded.applePay).toBe(true);
        expect(decoded.googlePay).toBe(false);
    });

    it('ExpressAvailabilityChangeEvent payload contains availableWallets', () => {
        const evt: ExpressAvailabilityChangeEvent = {
            availableWallets: { applePay: false, googlePay: true },
        };
        const decoded = JSON.parse(JSON.stringify(evt)) as ExpressAvailabilityChangeEvent;
        expect(decoded.availableWallets.applePay).toBe(false);
        expect(decoded.availableWallets.googlePay).toBe(true);
    });

    it('ElementReadyEvent may carry optional availableWallets: AvailableWallets', () => {
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
 * expressCheckout availability event registration contract (W1 + M1).
 * Covers: 'expressAvailabilityChange' is an EventName and present in EVENT_NAMES;
 * EventPayloadMap['expressAvailabilityChange'] is ExpressAvailabilityChangeEvent;
 * ElementReadyEvent and the event share the availableWallets field.
 */
describe('protocol express availability event registration', () => {
    it("'expressAvailabilityChange' is in EVENT_NAMES and recognized by isEventName", () => {
        expect(EVENT_NAMES).toContain('expressAvailabilityChange');
        expect(isEventName('expressAvailabilityChange')).toBe(true);
    });

    it("'expressAvailabilityChange' belongs to the EventName union type", () => {
        const name: EventName = 'expressAvailabilityChange';
        expect(name).toBe('expressAvailabilityChange');
    });

    it("EventPayloadMap['expressAvailabilityChange'] is ExpressAvailabilityChangeEvent", () => {
        const payload: EventPayloadMap['expressAvailabilityChange'] = {
            availableWallets: { applePay: true, googlePay: false },
        };
        // Type-equivalence assertion: the same reference is mutually assignable, proving the map
        // value is exactly ExpressAvailabilityChangeEvent.
        const asEvent: ExpressAvailabilityChangeEvent = payload;
        const asPayload: EventPayloadMap['expressAvailabilityChange'] = asEvent;
        expect(asPayload.availableWallets.applePay).toBe(true);
        expect(asPayload.availableWallets.googlePay).toBe(false);
    });

    it('EventPayloadMap.elementReady.availableWallets is optionally present', () => {
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

    it('accepts a valid message (type/elementId/height all present)', () => {
        expect(isIframeResizeMessage(valid)).toBe(true);
    });

    it('accepts height=0 (boundary, non-negative finite)', () => {
        expect(isIframeResizeMessage({ ...valid, height: 0 })).toBe(true);
    });

    it('rejects type mismatch', () => {
        expect(isIframeResizeMessage({ ...valid, type: 'other' })).toBe(false);
    });

    it('rejects empty-string / non-string elementId', () => {
        expect(isIframeResizeMessage({ ...valid, elementId: '' })).toBe(false);
        expect(isIframeResizeMessage({ ...valid, elementId: 123 })).toBe(false);
    });

    it('rejects non-finite / negative / non-number height', () => {
        expect(isIframeResizeMessage({ ...valid, height: Infinity })).toBe(false);
        expect(isIframeResizeMessage({ ...valid, height: -1 })).toBe(false);
        expect(isIframeResizeMessage({ ...valid, height: '42' })).toBe(false);
    });

    it('rejects non-object / null', () => {
        expect(isIframeResizeMessage(null)).toBe(false);
        expect(isIframeResizeMessage('x')).toBe(false);
        expect(isIframeResizeMessage(undefined)).toBe(false);
    });
});

/**
 * expressCheckout per-wallet options contract (wallet button theme follows Task 1).
 * Covers: paymentMethods.{applePay,googlePay} are `boolean | corresponding Options`;
 * ApplePayOptions/GooglePayOptions.buttonTheme are whitelisted union literals; the four new symbols
 * are exported from the protocol package.
 */
import type {
    ApplePayButtonTheme,
    ApplePayOptions,
    GooglePayButtonTheme,
    GooglePayOptions,
} from '@sunbay/checkout-sdk-protocol';

describe('protocol expressCheckout per-wallet options', () => {
    it('paymentMethods accepts a mixed "boolean | config object" shape', () => {
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

    it('ApplePayButtonTheme accepts black | white | white-outline', () => {
        const themes: ApplePayButtonTheme[] = ['black', 'white', 'white-outline'];
        for (const buttonTheme of themes) {
            const opts: ApplePayOptions = { buttonTheme };
            expect(opts.buttonTheme).toBe(buttonTheme);
        }
    });

    it('GooglePayButtonTheme accepts black | white | default', () => {
        const themes: GooglePayButtonTheme[] = ['black', 'white', 'default'];
        for (const buttonTheme of themes) {
            const opts: GooglePayOptions = { buttonTheme };
            expect(opts.buttonTheme).toBe(buttonTheme);
        }
    });

    it('ApplePayOptions/GooglePayOptions may omit buttonTheme', () => {
        const apple: ApplePayOptions = {};
        const google: GooglePayOptions = {};
        expect(apple.buttonTheme).toBeUndefined();
        expect(google.buttonTheme).toBeUndefined();
    });
});

describe('protocol appearance variables + rules', () => {
    it('Appearance accepts whitelisted variables + rules + colorScheme', () => {
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

    it('AppearanceRuleTarget covers the 7 semantic anchors', () => {
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

    it('AppearanceRuleStyle is an open map from property name to value', () => {
        const style: AppearanceRuleStyle = { color: '#000', 'border-radius': '4px' };
        expect(style.color).toBe('#000');
    });

    it('a non-whitelisted rule target should be rejected at the type layer', () => {
        const appearance: Appearance = {
            // @ts-expect-error body is not a valid AppearanceRuleTarget
            rules: { body: {} },
        };
        expect(appearance).toBeDefined();
    });
});

/**
 * expressCheckout wallet button buttonType + buttonHeight contract (Task 1).
 * Covers: ApplePayButtonType (14 official full set) / GooglePayButtonType (8) are whitelisted union
 * literals; ApplePayOptions/GooglePayOptions.buttonType accept valid values, invalid values rejected
 * at the type layer; ExpressCheckoutElementOptions.buttonHeight combines with per-wallet buttonType
 * and round-trips.
 */
import type {
    ApplePayButtonType,
    GooglePayButtonType,
} from '@sunbay/checkout-sdk-protocol';

describe('protocol expressCheckout buttonType + buttonHeight', () => {
    it('ApplePayButtonType accepts the 14 official full set', () => {
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

    it('GooglePayButtonType accepts the 8 official full set', () => {
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

    it('per-wallet buttonType + global buttonHeight combination assigns and round-trips equal', () => {
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

    it('ApplePayOptions/GooglePayOptions may omit buttonType (backward compatible)', () => {
        const apple: ApplePayOptions = {};
        const google: GooglePayOptions = {};
        expect(apple.buttonType).toBeUndefined();
        expect(google.buttonType).toBeUndefined();
    });

    it('an invalid applePay buttonType should be rejected at the type layer', () => {
        const opts: ExpressCheckoutElementOptions = {
            paymentMethods: {
                // @ts-expect-error 'nope' is not a valid ApplePayButtonType
                applePay: { buttonType: 'nope' },
            },
        };
        expect(opts).toBeDefined();
    });

    it('an invalid googlePay buttonType should be rejected at the type layer', () => {
        const opts: ExpressCheckoutElementOptions = {
            paymentMethods: {
                // @ts-expect-error 'pay-now' is not a valid GooglePayButtonType
                googlePay: { buttonType: 'pay-now' },
            },
        };
        expect(opts).toBeDefined();
    });
});
