import { describe, expect, test } from 'vitest';
import { defineApiVersions } from '../dsl/define-api-versions.ts';
import { retiredPinTarget } from './retired-pin-target.ts';

const api = defineApiVersions({
  '2026-01-01': { deprecated: { at: '2026-01-02', sunset: '2027-06-01' } },
  '2026-06-01': { deprecated: { at: '2026-06-02', sunset: '2026-07-01' } },
  '2026-11-11': {},
});

describe('retiredPinTarget', () => {
  test('a served pin stays', () => {
    expect(retiredPinTarget(api, '2026-11-11', '2026-11-12')).toBeUndefined();
    expect(retiredPinTarget(api, '2026-01-01', '2026-11-12')).toBeUndefined();
    expect(retiredPinTarget(api, '2026-06-01', '2026-06-20')).toBeUndefined();
  });

  test('a retired declared date moves to its served target', () => {
    expect(retiredPinTarget(api, '2026-06-01', '2026-11-12')).toBe('2026-11-11');
    expect(retiredPinTarget(api, '2026-06-01', '2026-07-02')).toBe('2026-11-11');
  });

  test('a pin below the oldest date moves to the oldest served date', () => {
    expect(retiredPinTarget(api, '2025-12-31', '2026-11-12')).toBe('2026-01-01');
  });

  test('an unknown or malformed pin is no target', () => {
    expect(retiredPinTarget(api, '2026-08-08', '2026-11-12')).toBeUndefined();
    expect(retiredPinTarget(api, 'not-a-date', '2026-11-12')).toBeUndefined();
    expect(retiredPinTarget(api, '', '2026-11-12')).toBeUndefined();
  });
});
