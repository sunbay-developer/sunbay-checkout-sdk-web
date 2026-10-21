import { describe, expect, it } from 'vitest';
import { resolveHostOrigin } from '../src/config/env';

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
