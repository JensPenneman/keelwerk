import { describe, expect, test } from 'vitest';
import { createStartLimiter } from '../../src/hub/start-limiter.ts';

/** Work that holds its slot until released, and counts how many hold one at once. */
function gate() {
  const open: (() => void)[] = [];
  const state = {
    running: 0,
    peak: 0,
    byScope: new Map<string, number>(),
    peakByScope: new Map<string, number>(),
  };
  const work = (scope: string) => async () => {
    state.running += 1;
    state.peak = Math.max(state.peak, state.running);
    const mine = (state.byScope.get(scope) ?? 0) + 1;
    state.byScope.set(scope, mine);
    state.peakByScope.set(scope, Math.max(state.peakByScope.get(scope) ?? 0, mine));
    await new Promise<void>((resolve) => open.push(resolve));
    state.running -= 1;
    state.byScope.set(scope, (state.byScope.get(scope) ?? 1) - 1);
    return scope;
  };
  const release = async (): Promise<void> => {
    const next = open.shift();
    next?.();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { state, work, release, waiting: () => open.length };
}

describe('the start limiter', () => {
  test('at most perScope units for a scope and perHub in all run at once; the others wait their turn', async () => {
    const limiter = createStartLimiter(2, 3);
    const { state, work, release } = gate();
    const live = new AbortController().signal;
    const all = [
      ...Array.from({ length: 5 }, () => limiter.run('a', live, work('a'))),
      ...Array.from({ length: 3 }, () => limiter.run('b', live, work('b'))),
      ...Array.from({ length: 3 }, () => limiter.run('c', live, work('c'))),
    ];
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.running).toBe(3);
    for (let at = 0; at < 11; at += 1) await release();
    expect(await Promise.all(all)).toHaveLength(11);
    expect(state.peak).toBe(3);
    expect(Math.max(...state.peakByScope.values())).toBe(2);
  });

  test('a waiter whose subscription ended leaves the queue and its work never runs', async () => {
    const limiter = createStartLimiter(1, 1);
    const { work, release, state } = gate();
    const live = new AbortController().signal;
    const first = limiter.run('a', live, work('a'));
    const gone = new AbortController();
    const waiting = limiter.run('a', gone.signal, work('a'));
    const third = limiter.run('a', live, work('a'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    gone.abort();
    expect(await waiting).toBeUndefined();
    await release();
    await release();
    expect(await first).toBe('a');
    expect(await third).toBe('a');
    expect(state.peak).toBe(1);
  });

  test('a scope that is full does not hold back the waiter of another scope', async () => {
    const limiter = createStartLimiter(1, 2);
    const { work, release, state } = gate();
    const live = new AbortController().signal;
    const first = limiter.run('a', live, work('a'));
    const blocked = limiter.run('a', live, work('a'));
    const other = limiter.run('b', live, work('b'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Scope a is full, the hub has a slot left: b runs.
    expect(state.running).toBe(2);
    await release();
    await release();
    await release();
    expect(await Promise.all([first, blocked, other])).toEqual(['a', 'a', 'b']);
  });
});
