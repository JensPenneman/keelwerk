import { describe, expect, test } from 'vitest';
import { declaredInstantOf } from './declared-instant-of.ts';

describe('declaredInstantOf', () => {
  test('a calendar date is the start of that UTC day', () => {
    expect(declaredInstantOf('2026-12-01')?.toString()).toBe('2026-12-01T00:00:00Z');
  });

  test('an instant with an offset is itself', () => {
    expect(declaredInstantOf('2026-12-01T10:00:00Z')?.toString()).toBe('2026-12-01T10:00:00Z');
    expect(declaredInstantOf('2026-12-01T10:00:00+05:00')?.toString()).toBe('2026-12-01T05:00:00Z');
  });

  test('a date-time without an offset and any other text name no instant', () => {
    expect(declaredInstantOf('2026-12-01T10:00:00')).toBeUndefined();
    expect(declaredInstantOf('Dec 1, 2026')).toBeUndefined();
    expect(declaredInstantOf('2026-02-30')).toBeUndefined();
    expect(declaredInstantOf('')).toBeUndefined();
  });
});
