import { afterAll, beforeAll, describe, expect, onTestFinished, test, vi } from 'vitest';
import { loopApp } from './support/loop-module.ts';
import type { ReactionsKit } from './support/reactions-kit.ts';
import { bootReactions } from './support/reactions-kit.ts';

describe.each(['memory', 'pglite'] as const)(
  'a drain under the default fake timers on %s',
  (adapter) => {
    let kit: ReactionsKit;
    beforeAll(async () => {
      kit = await bootReactions({ adapter, app: loopApp, watched: true });
    }, 120_000);
    afterAll(async () => {
      await kit.stop();
    });

    test('settles and takes the effect deadline job that the pinned clock made due, once', async () => {
      const started = await kit.call('acme', 'loop.start', { via: 'deadline' });
      expect(started.ok).toBe(true);
      // With real timers: the dispatcher and the reaction job run, and the effect's deadline job is
      // enqueued for one second after the start. Nothing takes it yet: the clock is pinned.
      await kit.settle();
      const spy = kit.spy;
      if (spy === undefined) throw new Error('the kit watches the job store');
      const deadlineJobs = spy.enqueued.filter((one) => one.job.queue === 'timers');
      expect(deadlineJobs).toHaveLength(1);
      const deadlineRun = JSON.stringify(deadlineJobs[0]?.job.run);
      expect(deadlineRun).toContain('effectDeadline');
      const takesBefore = spy.takes.length;
      const completionsBefore = spy.completions.length;

      vi.useFakeTimers();
      onTestFinished(() => {
        vi.useRealTimers();
      });
      kit.pin(kit.now().add({ seconds: 2 }));
      await kit.runtime.drainJobs();

      // The job waits in a queue of the workers, due since the pin. Their ticks now run on faked
      // timers, though a wall tick already pending when the timers were faked may still fire; the
      // assertions hold whichever of the two takes the job. Which other jobs the drain ran is not
      // asserted: the continuation of the deadline is the job's own, the dispatcher's reaction job
      // is not.
      const taken = spy.takes
        .slice(takesBefore)
        .filter((take) => take.queue === 'timers')
        .flatMap((take) => take.jobs);
      expect(taken.map((job) => JSON.stringify(job.run))).toEqual([deadlineRun]);
      const done = spy.completions
        .slice(completionsBefore)
        .filter((one) => one.attempt.jobId === taken[0]?.id);
      expect(done.map((one) => one.outcome.kind)).toEqual(['succeeded']);
    });
  },
);
