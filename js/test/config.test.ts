import { describe, expect, it } from 'vitest';
import { RUNTIME_BASE_PATH, resolveHostOrigin, runtimeUrl } from '../src/config/env';

/**
 * Environment config contract tests (source of truth: js/src/config/env).
 * Covers: default env=prod, explicit dev/test, override takes precedence.
 */
describe('resolveHostOrigin', () => {
    const DEV = 'https://checkout.sunbay-dev.com';
    const TEST = 'https://checkout.sunbay-uat.us';
    const PROD = 'https://checkout.sunbay.us';

    it('returns the prod origin by default', () => {
        expect(resolveHostOrigin()).toBe(PROD);
    });

    it("env='dev' returns the dev origin", () => {
        expect(resolveHostOrigin('dev')).toBe(DEV);
    });

    it("env='test' returns the test (UAT) origin", () => {
        expect(resolveHostOrigin('test')).toBe(TEST);
    });

    it("env='prod' returns the prod origin", () => {
        expect(resolveHostOrigin('prod')).toBe(PROD);
    });

    it('returns override first when override is non-empty', () => {
        expect(resolveHostOrigin('dev', 'http://localhost:3000')).toBe(
            'http://localhost:3000'
        );
    });
});

describe('runtimeUrl', () => {
    const ORIGIN = 'https://checkout.sunbay.us';

    it('exposes the runtime base path', () => {
        expect(RUNTIME_BASE_PATH).toBe('/embed/sdk');
    });

    it('runtimeUrl builds /embed/sdk/main', () => {
        expect(runtimeUrl(ORIGIN, 'main')).toBe(`${ORIGIN}/embed/sdk/main`);
    });

    it('runtimeUrl builds /embed/sdk/field/cardNumber', () => {
        expect(runtimeUrl(ORIGIN, 'field', 'cardNumber')).toBe(`${ORIGIN}/embed/sdk/field/cardNumber`);
    });

    it('runtimeUrl builds /embed/sdk/element/<type>', () => {
        expect(runtimeUrl(ORIGIN, 'element', 'card')).toBe(`${ORIGIN}/embed/sdk/element/card`);
    });

    it('runtimeUrl strips trailing slash from hostOrigin', () => {
        expect(runtimeUrl(`${ORIGIN}//`, 'main')).toBe(`${ORIGIN}/embed/sdk/main`);
    });
});
