import { expect, test } from 'vitest';
import { version } from '../src';

test('version is a string', () => {
    expect(typeof version).toBe('string');
});

test('version is a valid semver', () => {
    // 构建期由 tsup 从 package.json 注入；vitest 下无 define 替换，走回退 '0.0.0'。
    // 两种情形都必须是合法 semver 前缀，防回归到占位脱钩值。
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
});
