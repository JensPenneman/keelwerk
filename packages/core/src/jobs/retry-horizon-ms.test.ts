import { describe, expect, test } from 'vitest';
import { retryDelay } from '../worker/retry-delay.ts';
import { retryHorizonMs } from './retry-horizon-ms.ts';

const minute = 60 * 1000;
const hour = 60 * minute;

describe('the retry horizon of a job', () => {
  test('no policy: three attempts over the default largest delay', () => {
    expect(retryHorizonMs(undefined)).toBe(3 * 10 * minute);
    expect(retryHorizonMs({ delays: 'exponential' })).toBe(3 * 10 * minute);
  });

  test('a count limit times the largest delay, never above maxDelay', () => {
    expect(retryHorizonMs({ delays: 'exponential', limit: 10, maxDelay: '1h' })).toBe(10 * hour);
    expect(retryHorizonMs({ delays: ['1m', '5m'], limit: 4 })).toBe(4 * 5 * minute);
    expect(retryHorizonMs({ delays: ['2d'], limit: 2, maxDelay: '1h' })).toBe(2 * hour);
  });

  test('an empty list of delays falls back to the default largest delay, as the real retries do', () => {
    expect(retryHorizonMs({ delays: [], limit: 500 })).toBe(500 * 10 * minute);
  });

  test('a giveUpAfter without a limit is bounded by time alone', () => {
    expect(retryHorizonMs({ delays: 'exponential', giveUpAfter: '72h' })).toBe(72 * hour);
  });

  test('with both, the larger of the two', () => {
    expect(
      retryHorizonMs({ delays: 'exponential', limit: 100, maxDelay: '1h', giveUpAfter: '2h' }),
    ).toBe(100 * hour);
  });

  test('the defaults are those of the real retries: no policy, no more time than retryDelay lets pass', () => {
    const longest = (attempt: number) =>
      retryDelay({ delays: 'exponential', limit: 100 }, attempt, () => 0.999999);
    let attempts = 1;
    while (retryDelay(undefined, attempts, () => 0.999999) !== undefined) attempts += 1;
    expect(retryHorizonMs(undefined)).toBe(attempts * (longest(50) ?? 0));
  });
});
