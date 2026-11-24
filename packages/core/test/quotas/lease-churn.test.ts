import { describe, expect, test } from 'vitest';
import { churn } from './lease-churn.ts';
import { member, scopeId, sharedStore } from './lease-kit.ts';

// Three processes on one pair of the kit, the limit going 5, 2, 4, 1, 3, 1, with writes and renews
// held in flight. The kit runs on promises alone, so a turn of the event loop is a point at which
// every unit that can go on has gone on: the seeds fix every interleaving.
const seeds = Array.from({ length: 24 }, (_, index) => index + 1);

describe('a lowered limit under churn', () => {
  test('binds in every process of the kit once the lowering has reached it, and the store ends at zero', async () => {
    let admitted = 0;
    let refused = 0;
    for (const seed of seeds) {
      const store = sharedStore();
      const members = ['A', 'B', 'C'].map((holder) => member(store, holder));
      const outcome = await churn(
        {
          processes: members.map((one) => ({
            take: (limit) => one.ask(limit),
            pass: () => one.counter.pass(),
            hold: one.hold,
          })),
          stall: store.stall,
          quiet: () => new Promise<void>((resolve) => setImmediate(resolve)),
          total: async () => store.totalOf('subscriptions', scopeId),
        },
        { seed, steps: 600, limits: [5, 2, 4, 1, 3, 1] },
      );
      expect(outcome.violations).toEqual([]);
      expect(outcome.endTotal).toBe(0);
      admitted += outcome.admitted;
      refused += outcome.refused;
    }
    expect(admitted).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  });
});
