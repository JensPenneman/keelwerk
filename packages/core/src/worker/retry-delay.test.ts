import { describe, expect, test } from 'vitest';
import { retryDelay } from './retry-delay.ts';

const never = (): number => 0.999;
const zero = (): number => 0;

describe('retryDelay', () => {
  test('exponential delays double from one second and stay within [0, cap]', () => {
    expect(retryDelay({ delays: 'exponential', limit: 10 }, 1, never)).toBeLessThanOrEqual(1000);
    expect(retryDelay({ delays: 'exponential', limit: 10 }, 2, never)).toBeLessThanOrEqual(2000);
    expect(retryDelay({ delays: 'exponential', limit: 10 }, 3, never)).toBeLessThanOrEqual(4000);
    expect(retryDelay({ delays: 'exponential', limit: 10 }, 3, never)).toBeGreaterThan(3900);
    expect(retryDelay({ delays: 'exponential', limit: 10 }, 3, zero)).toBe(0);
  });

  test('maxDelay caps the series, and the default cap is ten minutes', () => {
    expect(
      retryDelay({ delays: 'exponential', limit: 99, maxDelay: '5s' }, 20, never),
    ).toBeLessThanOrEqual(5000);
    expect(retryDelay({ delays: 'exponential', limit: 99 }, 30, never)).toBeLessThanOrEqual(
      600_000,
    );
    expect(retryDelay({ delays: 'exponential', limit: 99 }, 30, never)).toBeGreaterThan(590_000);
  });

  test('explicit delays repeat the last one', () => {
    const retry = { delays: ['2s', '30s'], limit: 9 } as const;
    expect(retryDelay(retry, 1, never)).toBeLessThanOrEqual(2000);
    expect(retryDelay(retry, 2, never)).toBeLessThanOrEqual(30_000);
    expect(retryDelay(retry, 2, never)).toBeGreaterThan(2000);
    expect(retryDelay(retry, 7, never)).toBeLessThanOrEqual(30_000);
    expect(retryDelay(retry, 7, never)).toBeGreaterThan(2000);
  });

  test('a job without a policy is attempted three times, which is two retries', () => {
    expect(retryDelay(undefined, 1, never)).toBeDefined();
    expect(retryDelay(undefined, 2, never)).toBeDefined();
    expect(retryDelay(undefined, 3, never)).toBeUndefined();
  });

  test('the count limit is in attempts; no limit and a giveUpAfter leave the count open', () => {
    expect(retryDelay({ delays: 'exponential', limit: 1 }, 1, never)).toBeUndefined();
    expect(retryDelay({ delays: 'exponential' }, 3, never)).toBeUndefined();
    expect(retryDelay({ delays: 'exponential', giveUpAfter: 'PT6H' }, 50, never)).toBeDefined();
  });
});
