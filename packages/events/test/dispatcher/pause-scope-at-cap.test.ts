import type { Unit, WorkClassStats } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { pauseScopeAtCap } from '../../src/dispatcher/pause-scope-at-cap.ts';

/** Lane statistics with the jobs due now and the jobs queued in all (available, scheduled, waiting). */
const stats = (...queued: number[]): readonly WorkClassStats[] =>
  queued.map((count) => ({ queue: 'reactions', due: 0, queued: count }) as WorkClassStats);
const unitWith = (rows: readonly WorkClassStats[], asked: string[] = []): Unit =>
  ({
    jobs: {
      stats: (queue?: string) => {
        asked.push(String(queue));
        return Promise.resolve(rows);
      },
    },
  }) as unknown as Unit;

describe('pausing a scope at the cap of its reactions lane', () => {
  test('a lane at or below 90 percent of the cap passes, and only the reactions lane is asked', async () => {
    const asked: string[] = [];
    await expect(pauseScopeAtCap(unitWith(stats(9), asked), 10, 1000)).resolves.toBeUndefined();
    expect(asked).toEqual(['reactions']);
    await expect(pauseScopeAtCap(unitWith(stats(), []), 10, 1000)).resolves.toBeUndefined();
  });

  test('a lane above 90 percent holds the scope: rate_limited, core.queue_full, retryAfter the hold', async () => {
    await expect(pauseScopeAtCap(unitWith(stats(10)), 10, 2500)).rejects.toMatchObject({
      kind: 'rate_limited',
      code: 'core.queue_full',
      retryAfter: 2.5,
      retryable: true,
    });
  });

  test('the capability sets of the lane add up', async () => {
    await expect(pauseScopeAtCap(unitWith(stats(5, 5)), 10, 1000)).rejects.toMatchObject({
      code: 'core.queue_full',
    });
  });

  test('jobs in back-off or behind a key count although none is due: due 0 and queued 10 hold the scope', async () => {
    const rows = [
      { queue: 'reactions', due: 0, queued: 10 },
    ] as unknown as readonly WorkClassStats[];
    await expect(pauseScopeAtCap(unitWith(rows), 10, 1000)).rejects.toMatchObject({
      code: 'core.queue_full',
    });
    const due = [
      { queue: 'reactions', due: 10, queued: 9 },
    ] as unknown as readonly WorkClassStats[];
    await expect(pauseScopeAtCap(unitWith(due), 10, 1000)).resolves.toBeUndefined();
  });

  test('the batch is not weighed: a lane under 90 percent passes whatever the number of jobs the batch makes', async () => {
    await expect(pauseScopeAtCap(unitWith(stats(5)), 10, 1000)).resolves.toBeUndefined();
    // One job in back-off must not hold a scope whose batch is as big as the cap.
    await expect(pauseScopeAtCap(unitWith(stats(1)), 10, 1000)).resolves.toBeUndefined();
    // Past 90 percent the lane holds the scope.
    await expect(pauseScopeAtCap(unitWith(stats(10)), 10, 1000)).rejects.toMatchObject({
      code: 'core.queue_full',
    });
  });
});
