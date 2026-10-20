import { defineConfig } from 'tsup';
import pkg from './package.json';

// 构建期注入本包 package.json 的 version（见 src/index.ts 的 __SDK_VERSION__），
// 使 SDK 导出的 `version` 永远与 package.json 同步，无需手改代码。
// 用 JSON import（tsconfig resolveJsonModule）避免引入 node 类型依赖。

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs', 'iife'],
    globalName: 'SunbayCheckout',
    dts: true,
    sourcemap: true,
    clean: true,
    define: {
        __SDK_VERSION__: JSON.stringify(pkg.version),
    },
    outExtension({ format }) {
        if (format === 'esm') return { js: '.mjs' };
        if (format === 'cjs') return { js: '.cjs' };
        return { js: '.global.js' };
    },
});
