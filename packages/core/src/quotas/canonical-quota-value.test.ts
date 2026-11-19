import { describe, expect, test } from 'vitest';
import type { QuotaKind } from '../dsl/quota.ts';
import { canonicalQuotaValue } from './canonical-quota-value.ts';
import { parseQuotaValue } from './parse-quota-value.ts';

function canonical(kind: QuotaKind, text: string): string {
  return canonicalQuotaValue(parseQuotaValue(kind, text));
}

describe('canonicalQuotaValue', () => {
  test('bytes and counts are plain digits', () => {
    expect(canonical('bytes', '4MiB')).toBe('4194304');
    expect(canonical('bytes', '1.5GiB')).toBe('1610612736');
    expect(canonical('bytes', '12B')).toBe('12');
    expect(canonical('count', '007')).toBe('7');
    expect(canonical('count', '0')).toBe('0');
  });

  test('a rate is <count>/<milliseconds>ms whatever form the period was typed in', () => {
    expect(canonical('rate', '100/1m')).toBe('100/60000ms');
    expect(canonical('rate', '10/PT1M')).toBe('10/60000ms');
    expect(canonical('rate', '5/2h')).toBe('5/7200000ms');
    expect(canonical('rate', '3/500ms')).toBe('3/500ms');
  });

  test('the canonical form reads back to the same limit', () => {
    for (const [kind, text] of [
      ['bytes', '1.5GiB'],
      ['count', '007'],
      ['rate', '7/PT3M'],
      ['rate', '1/3ms'],
      ['rate', '999/1d'],
      ['rate', '1/9007199254740991ms'],
    ] as const) {
      const limit = parseQuotaValue(kind, text);
      expect(parseQuotaValue(kind, canonicalQuotaValue(limit))).toEqual(limit);
    }
  });
});
