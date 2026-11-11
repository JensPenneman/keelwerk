import type { Job } from '@keelwerk/core';
import { afterAll, describe, expect, test } from 'vitest';
import {
  enqueueAll,
  jobSpecOf,
  ownQueue,
  settleQueue,
  startWatched,
  statsOf,
} from './support/worker-kit.ts';

const { runtime, spy } = await startWatched();
afterAll(() => runtime.stop());

const slots = { slots: 2, capabilitySets: [''], revision: 1 };

/** A handler that runs until its signal aborts, then rejects with the reason; it keeps what it saw. */
function awaitsSignal() {
  const seen = {
    reasons: [] as unknown[],
    calls: [] as number[],
    started: Promise.withResolvers<void>(),
    aborted: Promise.withResolvers<void>(),
  };
  const handler = (job: Job): Promise<void> =>
    new Promise<void>((_, reject) => {
      seen.calls.push(job.stored.attempt.attempt);
      seen.started.resolve();
      job.signal.addEventListener('abort', () => {
        seen.reasons.push(job.signal.reason);
        seen.aborted.resolve();
        reject(job.signal.reason);
      });
    });
  return { seen, handler };
}

describe('an attempt ends at expireInSeconds and when it loses its lease', () => {
  test('the signal aborts with core.timeout at the expiry, and the job is retried', async () => {
    const t0 = runtime.clock.now();
    const queue = ownQueue(runtime);
    const { seen, handler } = awaitsSignal();
    await queue.work('expiry', handler, slots);
    await enqueueAll(runtime, queue, [jobSpecOf(runtime, { queue: 'expiry', expireInSeconds: 5 })]);
    queue.probe.wake();
    await seen.started.promise;
    await runtime.advanceTo(t0.add({ seconds: 4 }));
    queue.probe.wake();
    expect(seen.reasons).toEqual([]);
    await runtime.advanceTo(t0.add({ seconds: 5 }));
    queue.probe.wake();
    expect(seen.reasons).toHaveLength(1);
    expect(seen.reasons[0]).toMatchObject({ code: 'core.timeout', kind: 'unavailable' });
    await queue.probe.idle();
    expect(seen.calls).toEqual([1]);
    const waiting = (await statsOf(runtime, 'expiry'))?.nextDueAt;
    expect(waiting).toBeDefined();
    expect(waiting).not.toBeNull();
  });

  test('a renewal that finds the lease lost aborts the attempt with core.job_lease_lost and completes nothing', async () => {
    const t0 = runtime.clock.now();
    const queue = ownQueue(runtime);
    const { seen, handler } = awaitsSignal();
    await queue.work('lease', handler, slots);
    await enqueueAll(runtime, queue, [jobSpecOf(runtime, { queue: 'lease' })]);
    queue.probe.wake();
    await seen.started.promise;
    spy.heartbeat = () => [];
    spy.completions.length = 0;
    await runtime.advanceTo(t0.add({ seconds: 11 }));
    queue.probe.wake();
    await seen.aborted.promise;
    expect(seen.reasons[0]).toMatchObject({ code: 'core.job_lease_lost' });
    await queue.probe.idle();
    expect(spy.completions).toEqual([]);
    // Nobody completed it: the job stays running until a take reclaims the expired lease.
    expect((await statsOf(runtime, 'lease'))?.running).toBe(1);
    spy.heartbeat = undefined;
    await settleQueue(queue);
  });
});
