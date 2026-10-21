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
        return override;
    }
    return HOST_ORIGINS[env];
}
