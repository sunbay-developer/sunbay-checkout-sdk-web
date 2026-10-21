/**
 * Runtime environment identifier.
 * - `dev`: development/test hosted page.
 * - `prod`: production hosted page.
 */
export type Env = 'dev' | 'prod';

/**
 * Built-in hosted page origins (consistently without a trailing slash).
 */
const HOST_ORIGINS: Record<Env, string> = {
    dev: 'https://checkout.sunbay-dev.com',
    prod: 'https://checkout.sunbay.us',
};

/**
 * Resolve the hosted page origin.
 *
 * @param env - Runtime environment, defaults to `'dev'`.
 * @param override - Override origin (for env vars/tests); takes precedence when non-empty.
 * @returns Hosted page origin (without a trailing slash).
 * @example
 * resolveHostOrigin();                         // 'https://checkout.sunbay-dev.com'
 * resolveHostOrigin('prod');                   // 'https://checkout.sunbay.us'
 * resolveHostOrigin('dev', 'http://localhost:3000'); // 'http://localhost:3000'
 */
export function resolveHostOrigin(env: Env = 'dev', override?: string): string {
    if (override) {
        return override;
    }
    return HOST_ORIGINS[env];
}
