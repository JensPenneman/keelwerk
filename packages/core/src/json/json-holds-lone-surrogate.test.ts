import { describe, expect, test } from 'vitest';
import { jsonHoldsLoneSurrogate } from './json-holds-lone-surrogate.ts';

describe('jsonHoldsLoneSurrogate', () => {
  test('finds a lone high or low surrogate in a value and in a member name', () => {
    expect(jsonHoldsLoneSurrogate(JSON.stringify({ line: 'ab\ud83d' }))).toBe(true);
    expect(jsonHoldsLoneSurrogate(JSON.stringify({ line: '\ude00ab' }))).toBe(true);
    expect(jsonHoldsLoneSurrogate(JSON.stringify({ 'k\ud800': 1 }))).toBe(true);
    expect(jsonHoldsLoneSurrogate(JSON.stringify(['ok', { a: ['x\udfff'] }]))).toBe(true);
  });

  test('passes a pair, plain text that looks like an escape and ordinary text', () => {
    expect(jsonHoldsLoneSurrogate(JSON.stringify({ line: 'a\u{1f600}b' }))).toBe(false);
    expect(jsonHoldsLoneSurrogate(JSON.stringify({ line: '\\ud83d' }))).toBe(false);
    expect(jsonHoldsLoneSurrogate(JSON.stringify({ line: 'café' }))).toBe(false);
  });
});
