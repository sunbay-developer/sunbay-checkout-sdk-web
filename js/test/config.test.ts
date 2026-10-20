import { describe, expect, it } from 'vitest';
import { resolveHostOrigin } from '../src/config/env';

/**
 * 环境配置契约测试（真源：js/src/config/env）。
 * 覆盖：默认 env=dev、显式 prod、override 优先。
 */
describe('resolveHostOrigin', () => {
    const DEV = 'https://checkout.sunbay-dev.com';
    const PROD = 'https://checkout.sunbay.us';

    it('默认返回 dev 地址', () => {
        expect(resolveHostOrigin()).toBe(DEV);
    });

    it("env='prod' 返回 prod 地址", () => {
        expect(resolveHostOrigin('prod')).toBe(PROD);
    });

    it('override 非空时优先返回 override', () => {
        expect(resolveHostOrigin('dev', 'http://localhost:3000')).toBe(
            'http://localhost:3000'
        );
    });
});
