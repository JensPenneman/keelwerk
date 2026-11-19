import { describe, expect, test } from 'vitest';
import type { QuotaKind } from '../dsl/quota.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { parseQuotaValue } from './parse-quota-value.ts';

function refusal(kind: QuotaKind, value: string | number): KeelwerkError {
  try {
    parseQuotaValue(kind, value);
  } catch (error) {
    if (error instanceof KeelwerkError) return error;
    throw error;
  }
  throw new Error(`${JSON.stringify(value)} was accepted as a ${kind} quota`);
}

describe('parseQuotaValue', () => {
  test('bytes take a whole number or a binary unit', () => {
    expect(parseQuotaValue('bytes', 1024)).toEqual({ kind: 'bytes', value: 1024 });
    expect(parseQuotaValue('bytes', '12345')).toEqual({ kind: 'bytes', value: 12345 });
    expect(parseQuotaValue('bytes', '10GiB')).toEqual({ kind: 'bytes', value: 10_737_418_240 });
    expect(parseQuotaValue('bytes', '1.5KiB')).toEqual({ kind: 'bytes', value: 1536 });
    expect(parseQuotaValue('bytes', '7B')).toEqual({ kind: 'bytes', value: 7 });
  });

  test('counts take whole numbers at or above zero', () => {
    expect(parseQuotaValue('count', 0)).toEqual({ kind: 'count', value: 0 });
    expect(parseQuotaValue('count', '100')).toEqual({ kind: 'count', value: 100 });
  });

  test('a rate is a token bucket of its count over its period', () => {
    expect(parseQuotaValue('rate', '6000/1m')).toEqual({
      kind: 'rate',
      capacity: 6000,
      refillPerSecond: 100,
    });
    expect(parseQuotaValue('rate', '10/500ms')).toEqual({
      kind: 'rate',
      capacity: 10,
      refillPerSecond: 20,
    });
  });

  test('a text the kind refuses is core.malformed_request', () => {
    const refused: readonly [QuotaKind, string | number][] = [
      ['bytes', -1],
      ['bytes', '10GB'],
      ['bytes', '1e3'],
      ['bytes', ''],
      ['count', -1],
      ['count', 1.5],
      ['count', '1e3'],
      ['count', ''],
      ['rate', '0/1m'],
      ['rate', '5/0s'],
      ['rate', '5/soon'],
      ['rate', 100],
      ['rate', ''],
      ['rate', '1/PT0.0004S'],
      ['rate', '3/PT0.0014S'],
      ['rate', '1/999999999999999999d'],
      ['rate', '1/9999999999999999999999ms'],
    ];
    for (const [kind, value] of refused) {
      const error = refusal(kind, value);
      expect(error.kind).toBe('validation');
      expect(error.code).toBe('core.malformed_request');
      expect(error.message).toContain(kind);
    }
  });

  test('a period that is a whole number but too large names the largest period', () => {
    expect(refusal('rate', '1/999999999999999999d').message).toContain('9007199254740991');
    expect(refusal('rate', '1/9999999999999999999999ms').message).toContain('9007199254740991');
  });

  test('a refusal that quotes the duration parser ends in one full stop', () => {
    const { message } = refusal('rate', '1/1.5s');
    expect(message).toContain('PT24H');
    expect(message).not.toContain('..');
    expect(message.endsWith('.')).toBe(true);
  });
});
