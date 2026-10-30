/**
 * Runtime environment identifier.
 * - `dev`: development hosted page.
 * - `test`: UAT/test hosted page.
 * - `prod`: production hosted page.
 */
export type Env = 'dev' | 'test' | 'prod';

/**
 * Built-in hosted page origins (consistently without a trailing slash).
 */
const HOST_ORIGINS: Record<Env, string> = {
    dev: 'https://checkout.sunbay-dev.com',
    test: 'https://checkout.sunbay-uat.us',
    prod: 'https://checkout.sunbay.us',
};

/**
 * Resolve the hosted page origin.
 *
 * @param env - Runtime environment, defaults to `'prod'`.
 * @param override - Override origin (for env vars/tests); takes precedence when non-empty.
 * @returns Hosted page origin (without a trailing slash).
 * @example
 * resolveHostOrigin();                         // 'https://checkout.sunbay.us'
 * resolveHostOrigin('dev');                    // 'https://checkout.sunbay-dev.com'
 * resolveHostOrigin('test');                   // 'https://checkout.sunbay-uat.us'
 * resolveHostOrigin('dev', 'http://localhost:3000'); // 'http://localhost:3000'
 */
export function resolveHostOrigin(env: Env = 'prod', override?: string): string {
    if (override) {
        return override.replace(/\/+$/, '');
    }
    return HOST_ORIGINS[env];
}

/**
 * Base path under which the hosted runtime serves its pages (`main`, `field/*`, `element/*`).
 * Requires a hosted runtime that serves `/embed/sdk/*` (SDK >= 0.0.7).
 */
export const RUNTIME_BASE_PATH = '/embed/sdk';

/**
 * Build a hosted-runtime page URL (without a query string; callers append their own).
 *
 * @param hostOrigin - Hosted page origin; trailing slashes are stripped.
 * @param segment - `'main'` (hidden main frame), `'field'` (split field) or `'element'`.
 * @param type - Field/element type; required for `'field'` and `'element'`.
 * @returns Absolute URL such as `https://host/embed/sdk/field/cardNumber`.
 * @example
 * runtimeUrl('https://checkout.sunbay.us', 'main');                 // '.../embed/sdk/main'
 * runtimeUrl('https://checkout.sunbay.us/', 'field', 'cardNumber'); // '.../embed/sdk/field/cardNumber'
 */
export function runtimeUrl(
    hostOrigin: string,
    segment: 'main' | 'field' | 'element',
    type?: string
): string {
    const origin = hostOrigin.replace(/\/+$/, '');
    const path = type ? `${segment}/${type}` : segment;
    return `${origin}${RUNTIME_BASE_PATH}/${path}`;
}
