import { describe, expect, test } from 'vitest';
import { settleReactions } from './settle-reactions.ts';

/** A dispatcher and a drain that answer the given counts, round by round, and then 0. */
function rounds(dispatched: readonly number[], ran: readonly number[]) {
  let dispatching = 0;
  let draining = 0;
  return {
    dispatcher: { settled: async () => dispatched[dispatching++] ?? 0 },
    drain: async () => ran[draining++] ?? 0,
    calls: () => ({ dispatching, draining }),
  };
}

describe('settleReactions', () => {
  test('ends at the first round that dispatches nothing and runs nothing', async () => {
    const kit = rounds([1, 0], [2, 0]);
    await settleReactions(kit.dispatcher, kit.drain);
    expect(kit.calls()).toEqual({ dispatching: 2, draining: 2 });
  });

  test('a round that dispatches or runs something goes on, and rounds that never end throw', async () => {
    const busy = rounds(Array(40).fill(1), Array(40).fill(1));
    await expect(settleReactions(busy.dispatcher, busy.drain)).rejects.toThrow(
      'the reactions did not settle in 40 rounds',
    );
    expect(busy.calls()).toEqual({ dispatching: 40, draining: 40 });
  });
});
