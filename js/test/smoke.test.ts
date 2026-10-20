import { expect, test } from 'vitest';
import { version } from '../src';

test('version is a string', () => {
    expect(typeof version).toBe('string');
});
