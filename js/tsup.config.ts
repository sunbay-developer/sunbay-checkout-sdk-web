import { defineConfig } from 'tsup';
import pkg from './package.json';

// Inject this package's package.json version at build time (see __SDK_VERSION__ in src/index.ts),
// so the SDK's exported `version` always stays in sync with package.json without manual code edits.
// Use a JSON import (tsconfig resolveJsonModule) to avoid pulling in a node type dependency.

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
