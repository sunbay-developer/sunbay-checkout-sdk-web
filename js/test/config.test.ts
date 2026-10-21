import { describe, expect, it } from 'vitest';
import { resolveHostOrigin } from '../src/config/env';

/**
 * Environment config contract tests (source of truth: js/src/config/env).
 * Covers: default env=dev, explicit prod, override takes precedence.
 */
describe('resolveHostOrigin', () => {
    const DEV = 'https://checkout.sunbay-dev.com';
    const PROD = 'https://checkout.sunbay.us';

    it('returns the dev origin by default', () => {
        expect(resolveHostOrigin()).toBe(DEV);
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
