/**
 * 运行环境标识。
 * - `dev`：开发/测试托管页面。
 * - `prod`：生产托管页面。
 */
export type Env = 'dev' | 'prod';

/**
 * 内置托管页面 origin（统一不带尾部斜杠）。
 */
const HOST_ORIGINS: Record<Env, string> = {
    dev: 'https://checkout.sunbay-dev.com',
    prod: 'https://checkout.sunbay.us',
};

/**
 * 解析托管页面 origin。
 *
 * @param env - 运行环境，默认 `'dev'`。
 * @param override - 覆盖地址（供环境变量/测试使用）；非空时优先返回。
 * @returns 托管页面 origin（不带尾部斜杠）。
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
