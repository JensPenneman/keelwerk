import { errors } from '@keelwerk/core';
import { afterAll, describe, expect, test } from 'vitest';
import {
  enqueueAll,
  jobSpecOf,
  ownQueue,
  settleQueue,
  startWatched,
  statsOf,
} from './support/worker-kit.ts';

const { runtime } = await startWatched();
afterAll(() => runtime.stop());

const slots = { slots: 2, capabilitySets: [''], revision: 1 };
/** Seconds from `from` to `instant`. */
const seconds = (instant: Temporal.Instant, from: Temporal.Instant) =>
  instant.since(from).total('second');

describe('retries by the error taxonomy', () => {
  test('an unavailable attempt is rescheduled inside the policy bound, and the next attempt succeeds', async () => {
    const t0 = runtime.clock.now();
    const queue = ownQueue(runtime);
    const calls: number[] = [];
    await queue.work(
      'retry-unavailable',
      async (job) => {
        calls.push(job.stored.attempt.attempt);
        if (job.stored.attempt.attempt === 1) throw errors.unavailable('the destination is down');
      },
      slots,
    );
    await enqueueAll(runtime, queue, [jobSpecOf(runtime, { queue: 'retry-unavailable' })]);
    await settleQueue(queue);
    expect(calls).toEqual([1]);
    const waiting = (await statsOf(runtime, 'retry-unavailable'))?.nextDueAt;
    expect(waiting).toBeDefined();
    if (waiting === null || waiting === undefined) return;
    expect(seconds(waiting, t0)).toBeGreaterThanOrEqual(0);
    expect(seconds(waiting, t0)).toBeLessThanOrEqual(1);
    await runtime.advanceTo(waiting);
    await settleQueue(queue);
    expect(calls).toEqual([1, 2]);
    expect((await statsOf(runtime, 'retry-unavailable'))?.nextDueAt).toBeNull();
  });

  test('rate_limited with retryAfter blocks the group until then', async () => {
    const t0 = runtime.clock.now();
    const queue = ownQueue(runtime);
    const calls: string[] = [];
    await queue.work(
      'retry-rate',
      async (job) => {
        const { action, input } = job.stored.run as { action: string; input: { name: string } };
        calls.push(`${input.name}${job.stored.attempt.attempt}`);
        if (action === 'first' && job.stored.attempt.attempt === 1) {
          throw errors.rate_limited('slow down', { retryAfter: 30 });
        }
      },
      { ...slots, slots: 1 },
    );
    const group = { id: 'destination', concurrency: 5 };
    await enqueueAll(runtime, queue, [
      jobSpecOf(runtime, {
        queue: 'retry-rate',
        group,
        run: { action: 'first', input: { name: 'a' } },
      }),
      jobSpecOf(runtime, {
        queue: 'retry-rate',
        group,
        run: { action: 'second', input: { name: 'b' } },
      }),
    ]);
    await settleQueue(queue);
    expect(calls).toEqual(['a1']);
    // The second job is due but waits: its group is blocked until the retryAfter has passed.
    expect((await statsOf(runtime, 'retry-rate'))?.due).toBe(1);
    await runtime.advanceTo(t0.add({ seconds: 29 }));
    await settleQueue(queue);
    expect(calls).toEqual(['a1']);
    await runtime.advanceTo(t0.add({ seconds: 31 }));
    await settleQueue(queue);
    expect(calls.sort()).toEqual(['a1', 'a2', 'b1']);
  });

  test('when the policy has no attempts left the job fails and leaves the queue', async () => {
    const queue = ownQueue(runtime);
    let calls = 0;
    await queue.work(
      'retry-limit',
      async () => {
        calls += 1;
        throw errors.unavailable('still down');
      },
      slots,
    );
    const retry = { delays: 'exponential', limit: 2 } as const;
    await enqueueAll(runtime, queue, [jobSpecOf(runtime, { queue: 'retry-limit', retry })]);
    await settleQueue(queue);
    const next = (await statsOf(runtime, 'retry-limit'))?.nextDueAt;
    if (next === null || next === undefined)
      throw new Error('the first attempt was not rescheduled');
    await runtime.advanceTo(next);
    await settleQueue(queue);
    expect(calls).toBe(2);
    const stats = await statsOf(runtime, 'retry-limit');
    expect(stats?.nextDueAt).toBeNull();
    expect(stats?.due).toBe(0);
    expect(stats?.running).toBe(0);
  });
});
