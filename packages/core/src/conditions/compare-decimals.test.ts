import { expect, test } from 'vitest';
import { compareDecimals } from './compare-decimals.ts';

test('orders decimals by value, ignoring leading and trailing zeros', () => {
  expect(compareDecimals('1.50', '1.5')).toBe(0);
  expect(compareDecimals('007', '7.000')).toBe(0);
  expect(compareDecimals('-1', '1')).toBe(-1);
  expect(compareDecimals('0.0', '-0')).toBe(0);
  expect(compareDecimals('1.2', '1.10')).toBe(1);
  expect(compareDecimals('', '1')).toBeUndefined();
  expect(compareDecimals('1.2.3', '1')).toBeUndefined();
});

test('long runs of zeros finish fast and give the same answers', () => {
  const started = performance.now();
  const zeros = '0'.repeat(10_000);
  expect(compareDecimals(`1.${zeros}`, '1')).toBe(0);
  expect(compareDecimals(`1.${zeros}1`, '1')).toBe(1);
  expect(compareDecimals(`${zeros}1`, '1.0')).toBe(0);
  expect(compareDecimals(`0.${zeros}`, '0')).toBe(0);
  expect(compareDecimals(`1.${'0'.repeat(10_000)}x`, '1')).toBeUndefined();
  expect(performance.now() - started).toBeLessThan(500);
});
