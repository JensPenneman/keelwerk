import { describe, expect, test } from 'vitest';
import { isCommandId } from './is-command-id.ts';

describe('isCommandId', () => {
  test('1 to 255 visible ASCII characters pass; empty, long, spaced and non-ASCII ids do not', () => {
    expect(isCommandId('a')).toBe(true);
    expect(isCommandId('order-42/retry:1')).toBe(true);
    expect(isCommandId('x'.repeat(255))).toBe(true);
    expect(isCommandId('')).toBe(false);
    expect(isCommandId('x'.repeat(256))).toBe(false);
    expect(isCommandId('two words')).toBe(false);
    expect(isCommandId('café')).toBe(false);
    expect(isCommandId('line\nbreak')).toBe(false);
  });
});
