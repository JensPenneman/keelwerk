import type { NamespaceRef, Position } from '@keelwerk/core';
import { pollChangeFeed } from '@keelwerk/data';
import { expect, test } from 'vitest';

const namespace: NamespaceRef = {
  id: 'ns-1',
  placementId: 'main',
  appId: 'app',
  tenantId: null,
  root: 'app',
};

/** A feed over scope heads kept in a map; every `sleep` runs `onSleep` and then resolves. */
function fixture(onSleep: (round: number) => void, pageSize = 1000) {
  const heads = new Map<string, Position>();
  let round = 0;
  const feed = pollChangeFeed({
    pageSize,
    moved: async (_namespace, since, limit) =>
      [...heads]
        .filter(([id, head]) => head > (since.get(id) ?? 0n))
        .slice(0, limit)
        .map(([scopeId, head]) => ({ scopeId, head })),
    sleep: async () => {
      round += 1;
      onSleep(round);
    },
  });
  return { heads, feed };
}

test('the first poll names every scope with events, later polls the scopes that moved since', async () => {
  const stop = new AbortController();
  const { heads, feed } = fixture((round) => {
    if (round === 1) heads.set('a', 2n);
    if (round === 2) heads.set('b', 1n);
  });
  heads.set('a', 1n);
  const wakes = feed.wake([namespace], stop.signal)[Symbol.asyncIterator]();
  expect(feed.level).toBe('poll');
  expect((await wakes.next()).value).toEqual({ namespace: 'ns-1', scopeIds: ['a'] });
  expect((await wakes.next()).value).toEqual({ namespace: 'ns-1', scopeIds: ['a'] });
  expect((await wakes.next()).value).toEqual({ namespace: 'ns-1', scopeIds: ['b'] });
  stop.abort();
  expect((await wakes.next()).done).toBe(true);
});

test('more moved scopes than a page are read page by page', async () => {
  const stop = new AbortController();
  const { heads, feed } = fixture((round) => {
    if (round === 1) for (const id of ['a', 'b', 'c', 'd', 'e']) heads.set(id, 1n);
  }, 2);
  const wakes = feed.wake([namespace], stop.signal)[Symbol.asyncIterator]();
  expect((await wakes.next()).value).toEqual({
    namespace: 'ns-1',
    scopeIds: ['a', 'b', 'c', 'd', 'e'],
  });
  stop.abort();
});

test('a failing poll is reported and the next round carries on', async () => {
  const stop = new AbortController();
  const errors: unknown[] = [];
  let calls = 0;
  const feed = pollChangeFeed({
    moved: async (_namespace, since) => {
      calls += 1;
      if (calls === 2) throw new Error('down');
      return since.size === 0 && calls > 2 ? [{ scopeId: 'a', head: 1n }] : [];
    },
    sleep: async () => undefined,
    onError: (_namespace, error) => errors.push(error),
  });
  const wakes = feed.wake([namespace], stop.signal)[Symbol.asyncIterator]();
  expect((await wakes.next()).value).toEqual({ namespace: 'ns-1', scopeIds: ['a'] });
  expect(errors).toHaveLength(1);
  stop.abort();
});

test('the pause between polls is one interval after a good poll and grows by the policy while polls fail', async () => {
  const stop = new AbortController();
  const pauses: number[] = [];
  // The polls, in order: good, failed, failed, failed, good.
  const outcomes = ['good', 'failed', 'failed', 'failed', 'good'];
  let calls = 0;
  const feed = pollChangeFeed({
    moved: async () => {
      calls += 1;
      if (outcomes[calls - 1] === 'failed') throw new Error('down');
      return calls === 5 ? [{ scopeId: 'a', head: 1n }] : [];
    },
    sleep: async (ms) => {
      pauses.push(ms);
    },
    random: () => 0.5,
    onError: () => undefined,
  });
  const wakes = feed.wake([namespace], stop.signal)[Symbol.asyncIterator]();
  // The fifth poll is the first to name a scope.
  expect((await wakes.next()).value).toEqual({ namespace: 'ns-1', scopeIds: ['a'] });
  expect(pauses).toEqual([1000, 1000, 2000, 4000]);
  stop.abort();
});

test('a pause after a failed poll is never shorter than the interval', async () => {
  const stop = new AbortController();
  const pauses: number[] = [];
  let calls = 0;
  const feed = pollChangeFeed({
    intervalMs: 5000,
    moved: async () => {
      calls += 1;
      if (calls < 3) throw new Error('down');
      return [{ scopeId: 'a', head: 1n }];
    },
    sleep: async (ms) => {
      pauses.push(ms);
    },
    random: () => 0.5,
    onError: () => undefined,
  });
  const wakes = feed.wake([namespace], stop.signal)[Symbol.asyncIterator]();
  expect((await wakes.next()).value).toEqual({ namespace: 'ns-1', scopeIds: ['a'] });
  expect(pauses).toEqual([5000, 5000]);
  stop.abort();
});

test('a poll that succeeds starts the failures again: the next failure pauses one interval', async () => {
  const stop = new AbortController();
  const pauses: number[] = [];
  // The polls, in order: failed, failed, good (names a scope), failed, good (names another).
  const outcomes = ['failed', 'failed', 'good', 'failed', 'good'];
  let calls = 0;
  const feed = pollChangeFeed({
    moved: async () => {
      calls += 1;
      if (outcomes[calls - 1] === 'failed') throw new Error('down');
      return [{ scopeId: `scope-${calls}`, head: 1n }];
    },
    sleep: async (ms) => {
      pauses.push(ms);
    },
    random: () => 0.5,
    onError: () => undefined,
  });
  const wakes = feed.wake([namespace], stop.signal)[Symbol.asyncIterator]();
  await wakes.next();
  await wakes.next();
  expect(pauses).toEqual([1000, 2000, 1000, 1000]);
  stop.abort();
});
