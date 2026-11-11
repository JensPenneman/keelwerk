import type { JobOutcome, StoredJobSpec, WireError } from '@keelwerk/core';
import { reactionQueue } from '@keelwerk/core';
import { expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { jobStoreHelpers } from './job-store-helpers.ts';

const namespaceScope = { level: 'namespace', reason: 'conformance' } as const;
const succeeded: JobOutcome = { kind: 'succeeded' };
const unavailable: WireError = {
  kind: 'unavailable',
  code: 'core.unavailable',
  message: 'down',
  retryable: true,
  requestId: 'r',
};

/**
 * The jobs a class holds that are not yet running (21.4, 9.5.5) and the replacement of a pending
 * job by the one of a later event (7.7), against the job store of every adapter.
 */
export function jobStorePendingCases(subject: Pick<ConformanceSubject, 'run' | 'clock'>): void {
  const now = (): Temporal.Instant => subject.clock?.now() ?? Temporal.Now.instant();
  const { take, enqueue, finish, only, inputs, numbered } = jobStoreHelpers(subject);
  /** A job at `position` that replaces the pending job of its key, ordered like a coalescing reaction's. */
  const latest = (n: number, position: string, queue: StoredJobSpec['queue'] = reactionQueue) =>
    numbered(n, {
      queue,
      run: { action: 'a', input: { n, position } },
      key: { value: 'latest', onConflict: 'replace' },
      ordering: 'fifo-per-key',
    });
  const onReactions = { queue: reactionQueue } as const;
  const queuedOf = async (): Promise<readonly [number, number, number]> => {
    const [row] = await subject.run(namespaceScope, (unit) => unit.jobs.stats('commands'));
    return [row?.queued ?? -1, row?.due ?? -1, row?.running ?? -1];
  };

  test('queued counts the available, scheduled and waiting jobs, and no running or dead one', async () => {
    await enqueue([numbered(1)]);
    const running = only(await take('w1', { limit: 1 }));
    const appended = (n: number) =>
      numbered(n, { key: { value: 'chain', onConflict: 'append' }, ordering: 'fifo-per-key' });
    await enqueue([
      numbered(2),
      numbered(3, { runAt: now().add({ hours: 1 }) }),
      appended(4),
      appended(5),
    ]);
    expect(await queuedOf()).toEqual([4, 2, 1]);
    expect(await finish(running, 'w1', { kind: 'dead', error: unavailable })).toBe(true);
    expect(await queuedOf()).toEqual([4, 2, 0]);
  });

  test('replace keeps the pending job of a later event and drops the job of an older one', async () => {
    const [first] = await enqueue([latest(1, '10')]);
    const [older] = await enqueue([latest(2, '5')]);
    expect(older).toBe(first);
    const [same] = await enqueue([latest(3, '10')]);
    expect(same).toBe(first);
    const [newer] = await enqueue([latest(4, '11')]);
    expect(newer).not.toBe(first);
    expect(inputs([only(await take('w1', onReactions))])).toEqual([{ n: 4, position: '11' }]);
    expect(await take('w2', onReactions)).toEqual([]);
  });

  test('a replacing job waits behind the running job of its key, and a later one replaces the waiting one', async () => {
    await enqueue([latest(1, '1')]);
    const running = only(await take('w1', onReactions));
    await enqueue([latest(2, '2')]);
    expect(await take('w2', onReactions)).toEqual([]);
    await enqueue([latest(3, '3')]);
    expect(await take('w2', onReactions)).toEqual([]);
    expect(await finish(running, 'w1', succeeded)).toBe(true);
    expect(inputs([only(await take('w2', onReactions))])).toEqual([{ n: 3, position: '3' }]);
    expect(await take('w3', onReactions)).toEqual([]);
  });

  test('replace on another queue always replaces, whatever positions the inputs name', async () => {
    const [first] = await enqueue([latest(1, '7', 'timers')]);
    const [smaller] = await enqueue([latest(2, '3', 'timers')]);
    expect(smaller).not.toBe(first);
    expect(inputs([only(await take('w1', { queue: 'timers' }))])).toEqual([
      { n: 2, position: '3' },
    ]);
    expect(await take('w2', { queue: 'timers' })).toEqual([]);
  });
}
