import { describe, expect, test } from 'vitest';
import { defineApiVersions } from '../dsl/define-api-versions.ts';
import { servedTargetOf } from './served-target-of.ts';

const extended = defineApiVersions({
  '2026-01-01': { deprecated: { at: '2026-01-02', sunset: '2027-06-01' } },
  '2026-06-01': { deprecated: { at: '2026-06-02', sunset: '2026-07-01' } },
  '2026-09-01': { deprecated: { at: '2026-09-02', sunset: '2026-10-01' } },
  '2026-11-11': {},
});

describe('servedTargetOf (section 18.5)', () => {
  test('is the oldest served date newer than the version, so an older extended one is skipped', () => {
    expect(servedTargetOf(extended, '2026-06-01', '2026-11-12')).toBe('2026-11-11');
    expect(servedTargetOf(extended, '2026-06-01', '2026-09-15')).toBe('2026-09-01');
  });

  test('a date below the oldest declared goes to the oldest served one, and past every sunset the head is the target', () => {
    expect(servedTargetOf(extended, '2025-12-31', '2026-11-12')).toBe('2026-01-01');
    expect(servedTargetOf(extended, '2026-09-01', '2027-07-01')).toBe('2026-11-11');
  });
});
