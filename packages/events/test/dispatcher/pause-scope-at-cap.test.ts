import type { Unit } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { pauseScopeAtCap } from '../../src/dispatcher/pause-scope-at-cap.ts';

/** A unit whose lane holds `held` waiting jobs; the store counts as the bounded `queued` does, and records what it is asked. */
function unitWith(held: number, asked: { queue: string; limit: number }[] = []): Unit {
  return {
    jobs: {
      queued: (queue: string, limit: number) => {
        asked.push({ queue, limit });
        return Promise.resolve(Math.min(held, limit + 1));
      },
      stats: () => Promise.reject(new Error('the pause must not read the statistics')),
    },
  } as unknown as Unit;
}

describe('pausing a scope at the cap of its reactions lane', () => {
  test('the lane is asked with limit floor(9q/10) on the reactions queue', async () => {
    for (const [cap, line] of [
      [10, 9],
      [1, 0],
      [3, 2],
      [10_000, 9000],
      [11, 9],
    ] as const) {
      const asked: { queue: string; limit: number }[] = [];
      await pauseScopeAtCap(unitWith(0, asked), cap, 1000);
      expect(asked).toEqual([{ queue: 'reactions', limit: line }]);
    }
  });

  test('the largest cap the dispatcher accepts asks for a limit the job store takes', async () => {
    const asked: { queue: string; limit: number }[] = [];
    await pauseScopeAtCap(unitWith(0, asked), 2_386_092_940, 1000);
    expect(asked).toEqual([{ queue: 'reactions', limit: 2_147_483_646 }]);
  });

  test('a lane at or below 90 percent of the cap passes', async () => {
    await expect(pauseScopeAtCap(unitWith(9), 10, 1000)).resolves.toBeUndefined();
    await expect(pauseScopeAtCap(unitWith(0), 10, 1000)).resolves.toBeUndefined();
    await expect(pauseScopeAtCap(unitWith(0), 1, 1000)).resolves.toBeUndefined();
  });

  test('more than the line holds the scope: rate_limited, core.queue_full, retryAfter', async () => {
    await expect(pauseScopeAtCap(unitWith(10), 10, 2500)).rejects.toMatchObject({
      kind: 'rate_limited',
      code: 'core.queue_full',
      retryAfter: 2.5,
      retryable: true,
    });
    // A cap of 1 has a line of 0: one waiting job holds the scope.
    await expect(pauseScopeAtCap(unitWith(1), 1, 1000)).rejects.toMatchObject({
      code: 'core.queue_full',
    });
  });

  test('a lane far above the line is read no further than one job past it', async () => {
    const asked: { queue: string; limit: number }[] = [];
    await expect(pauseScopeAtCap(unitWith(5_000_000, asked), 10_000, 1000)).rejects.toMatchObject({
      code: 'core.queue_full',
    });
    expect(asked).toEqual([{ queue: 'reactions', limit: 9000 }]);
  });

  test('stats is never called', async () => {
    await expect(pauseScopeAtCap(unitWith(3), 10, 1000)).resolves.toBeUndefined();
    await expect(pauseScopeAtCap(unitWith(30), 10, 1000)).rejects.toMatchObject({
      code: 'core.queue_full',
    });
  });
});
