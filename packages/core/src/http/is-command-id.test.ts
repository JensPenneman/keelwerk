import { describe, expect, test } from 'vitest';
import { isCommandId } from './is-command-id.ts';

describe('isCommandId', () => {
  test('a UUID or a ULID passes', () => {
    expect(isCommandId('01930000-0000-7000-8000-000000000001')).toBe(true);
    expect(isCommandId('2D9B8C4E-6F1A-4B7D-9C3E-5A1F0E8D7B6C')).toBe(true);
    expect(isCommandId('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
  });

  test('any other text does not: names, emails, hashes of a name, empty and long ids', () => {
    expect(isCommandId('a')).toBe(false);
    expect(isCommandId('order-42/retry:1')).toBe(false);
    expect(isCommandId('order-jan@example.com')).toBe(false);
    expect(isCommandId('6fa459ea-ee8a-3ca4-894e-db77e160355e')).toBe(false);
    expect(isCommandId('')).toBe(false);
    expect(isCommandId('x'.repeat(256))).toBe(false);
    expect(isCommandId('line\nbreak')).toBe(false);
  });
});
