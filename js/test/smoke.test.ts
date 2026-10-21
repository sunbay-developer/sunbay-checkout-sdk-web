import { expect, test } from 'vitest';
import { version } from '../src';

test('version is a string', () => {
    expect(typeof version).toBe('string');
});

test('version is a valid semver', () => {
    // Injected by tsup from package.json at build time; under vitest there is no define
    // replacement, so it falls back to '0.0.0'. Both cases must be a valid semver prefix
    // to prevent regressing to a decoupled placeholder value.
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
});
