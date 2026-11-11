import type { Job } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import { gate } from './support/job-spy.ts';
import {
  acmeScope,
  askCloseAll,
  enqueueAll,
  jobOf,
  jobSpecOf,
  lendBook,
  lines,
  ownQueue,
  startWatched,
  statsOf,
} from './support/worker-kit.ts';

/** A job of a queue only the held workers slot, so nothing wakes it: the test drains it by hand. */
async function enqueueHeld(runtime: Awaited<ReturnType<typeof startWatched>>['runtime']) {
  await lendBook(runtime, 'Dune');
  await runtime.adapter.unit(runtime.namespace, acmeScope(runtime), (unit) =>
    unit.jobs.enqueue(
      jobOf(runtime, {
        queue: 'held',
        run: { action: 'loans.openDesk', input: { desk: 'north' }, commandId: 's-1' },
        principal: { resolver: 'test.principal', principalId: 'bea' },
      }),
    ),
  );
}

describe('stop drains the workers within its deadline', () => {
  test('a job that settles before the deadline is completed and nothing is abandoned', async () => {
    const log = lines();
    const { runtime, spy } = await startWatched({
      workers: { queues: ['held'] },
      logger: log.logger,
    });
    await enqueueHeld(runtime);
    const door = gate(1);
    spy.hold = door;
    const draining = runtime.drainJobs();
    await door.entered;
    const stopping = runtime.stop(5_000);
    door.release();
    await stopping;
    await draining;
    expect(
      spy.completions.map((entry) => [entry.attempt.attempt, entry.granted, entry.outcome.kind]),
    ).toEqual([[1, true, 'succeeded']]);
    expect(log.warnings.filter((line) => line.includes('still running'))).toEqual([]);
  });

  test('a handler that never settles does not hold stop past its deadline; the job stays running for its lease', async () => {
    const { runtime, spy } = await startWatched({ workers: { queues: ['held'] } });
    await enqueueHeld(runtime);
    const door = gate(1);
    spy.hold = door;
    void runtime.drainJobs().catch(() => undefined);
    await door.entered;
    expect((await statsOf(runtime, 'held'))?.running).toBe(1);
    await runtime.stop(50);
    expect(spy.completions).toEqual([]);
  });

  test('at the deadline the attempts left are aborted with a shutdown reason and completed by nobody', async () => {
    const { runtime, spy } = await startWatched();
    const queue = ownQueue(runtime);
    const seen = {
      started: Promise.withResolvers<void>(),
      aborted: Promise.withResolvers<unknown>(),
    };
    const never = (job: Job): Promise<void> => {
      job.signal.addEventListener('abort', () => seen.aborted.resolve(job.signal.reason));
      seen.started.resolve();
      return new Promise<void>(() => undefined);
    };
    const handle = await queue.work('stuck', never, {
      slots: 1,
      capabilitySets: [''],
      revision: 1,
    });
    await enqueueAll(runtime, queue, [jobSpecOf(runtime, { queue: 'stuck' })]);
    queue.probe.wake();
    await seen.started.promise;
    expect(await handle.drain(Temporal.Now.instant())).toBe(1);
    expect(await seen.aborted.promise).toMatchObject({ code: 'core.unavailable' });
    queue.probe.wake();
    expect(spy.completions).toEqual([]);
    expect((await statsOf(runtime, 'stuck'))?.running).toBe(1);
    await runtime.stop();
  });

  test('a fetcher drained twice does not stop the renewals of the others', async () => {
    const { runtime, spy } = await startWatched();
    const queue = ownQueue(runtime);
    const door = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const options = { slots: 1, capabilitySets: [''], revision: 1 };
    const idle = await queue.work('quiet', async () => undefined, options);
    await queue.work(
      'busy',
      async () => {
        started.resolve();
        await door.promise;
      },
      options,
    );
    await enqueueAll(runtime, queue, [jobSpecOf(runtime, { queue: 'busy' })]);
    queue.probe.wake();
    await started.promise;
    const renewed: number[] = [];
    spy.heartbeat = (attempts) => {
      renewed.push(attempts.length);
      return undefined;
    };
    await idle.drain(Temporal.Now.instant());
    await idle.drain(Temporal.Now.instant());
    await runtime.advanceTo(runtime.clock.now().add({ seconds: 11 }));
    queue.probe.wake();
    await vi.waitFor(() => expect(renewed).toContain(1));
    door.resolve();
    await queue.probe.idle();
    await runtime.stop();
  });

  test('a runtime without workers starts no fetcher: the job stays available', async () => {
    const { runtime } = await startWatched();
    await lendBook(runtime, 'Dune');
    await askCloseAll(runtime, 's-3');
    expect(await runtime.advanceTo(runtime.clock.now().add({ hours: 1 }))).toBe(0);
    const stats = await statsOf(runtime, 'commands');
    expect([stats?.due, stats?.running]).toEqual([1, 0]);
    await expect(runtime.drainJobs()).rejects.toMatchObject({ code: 'core.internal' });
    await runtime.stop();
  });
});
