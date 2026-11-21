import { isKeelwerkError } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import type { QueueScenarioKit } from './queue-scenario-kit.ts';

const { tenantA } = conformanceScopes;
/** A lease lasts three heartbeats of ten seconds; this is past it. */
const pastLease = 31_000;

const codeOf = (reason: unknown): string | undefined =>
  isKeelwerkError(reason) ? reason.code : undefined;

/** Heartbeats, lost leases, fencing and the release at a drain (9.5.4, 21.6, 21.7), through the kernel queue. */
export function queueScenarioLeaseCases(
  kit: () => QueueScenarioKit,
  subject: Pick<ConformanceSubject, 'run' | 'adapter'>,
): void {
  test('heartbeats keep the lease: a running job outlives its first lease and no other worker takes it', {
    timeout: 60_000,
  }, async () => {
    const k = kit();
    await k.enqueue([k.job(1)]);
    k.script(1, ['hold']);
    const w1 = await k.worker('w1');
    await k.until(() => k.runs.length === 1);
    for (let round = 0; round < 3; round += 1) {
      const before = w1.renewals();
      k.clock().advance(11_000);
      await k.until(() => w1.renewals() > before);
    }
    await k.worker('w2');
    expect(await k.probeTake()).toEqual([]);
    expect(k.runs).toHaveLength(1);
    k.resume(1);
    await k.until(() => k.runs[0]?.end === 'completed');
    expect(k.runs).toHaveLength(1);
    expect(await k.written()).toEqual(['1/1']);
  });

  test('a lost lease is reclaimed by the next take; the paused attempt wakes before it learns of it and its completion is refused, its writes roll back', {
    timeout: 60_000,
  }, async () => {
    const k = kit();
    await k.enqueue([k.job(1)]);
    k.script(1, ['hold', 'succeed']);
    const w1 = await k.worker('w1', 1);
    await k.until(() => k.runs.length === 1);
    w1.cut();
    k.clock().advance(pastLease);
    await k.worker('w2');
    await k.until(() => k.runs.some((run) => run.worker === 'w2' && run.end === 'completed'));
    expect(k.runs.map((run) => [run.worker, run.attempt])).toEqual([
      ['w1', 1],
      ['w2', 2],
    ]);
    // The signal of the paused attempt is live and its renewals are cut: it writes its row and asks
    // the store to complete, which answers false, and the unit rolls back.
    expect(k.runs[0]?.abortReason).toBeUndefined();
    k.resume(1);
    await k.until(() => k.runs[0]?.end === 'fenced');
    expect(await k.written()).toEqual(['1/2']);
  });

  test('a worker that reaches the store again learns of the lost lease: the renewal answers nothing, the attempt is aborted and refused', {
    timeout: 60_000,
  }, async () => {
    const k = kit();
    await k.enqueue([k.job(1)]);
    k.script(1, ['hold', 'succeed']);
    const w1 = await k.worker('w1', 1);
    await k.until(() => k.runs.length === 1);
    w1.cut();
    k.clock().advance(pastLease);
    await k.worker('w2');
    await k.until(() => k.runs.some((run) => run.worker === 'w2' && run.end === 'completed'));
    const [late] = k.runs;
    if (late === undefined) throw new Error('the first attempt did not run');
    const renewed = w1.renewals();
    w1.heal();
    await k.until(() => late.abortReason !== undefined);
    expect(codeOf(late.abortReason)).toBe('core.job_lease_lost');
    expect(w1.renewals()).toBe(renewed);
    expect(await k.renew(late)).toEqual([]);
    k.resume(1);
    await k.until(() => late.end === 'refused');
    expect(await k.written()).toEqual(['1/2']);
  });

  test('three lost leases make a dead letter that keeps its input', {
    timeout: 60_000,
  }, async () => {
    const k = kit();
    await k.enqueue([k.job(1)]);
    k.script(1, ['hold', 'hold', 'hold', 'succeed']);
    for (const [index, id] of ['w1', 'w2', 'w3'].entries()) {
      const worker = await k.worker(id, 1);
      await k.until(() => k.runs.length === index + 1);
      worker.cut();
      k.clock().advance(pastLease);
    }
    await k.worker('w4');
    await k.until(async () => {
      const stats = await k.stats();
      return stats?.running === 0 && stats.due === 0 && stats.queued === 0;
    });
    expect(await k.probeTake()).toEqual([]);
    expect(k.runs.map((run) => run.worker)).toEqual(['w1', 'w2', 'w3']);
    k.resume(1);
    await k.until(() => k.runs.every((run) => run.end === 'fenced'));
    expect(await k.written()).toEqual([]);
    const purged = await subject.run(tenantA, (unit) =>
      unit.jobs.purgeForPrincipals(['p'], ['scenarios']),
    );
    expect(purged).toEqual([{ queue: 'scenarios', run: { action: 'scenario.run', input: 1 } }]);
  });

  test('a drain releases the running attempt: another worker takes it under the same attempt number', {
    timeout: 60_000,
  }, async () => {
    const k = kit();
    await k.enqueue([k.job(1)]);
    k.script(1, ['hold']);
    const w1 = await k.worker('w1');
    await k.until(() => k.runs.length === 1);
    // w2 has swept (and found nothing to take) before the drain begins. Its kernel clock moves only
    // by `advance`, and the test sends it no probe.wake: no sweep at rest is asked for.
    const clock = k.pinnedClock();
    const w2 = await k.worker('w2', 4, clock);
    await w2.queue.probe.idle();
    expect(await w1.drain(Temporal.Now.instant())).toBe(1);
    expect(codeOf(k.runs[0]?.abortReason)).toBe('core.unavailable');
    if (subject.adapter().feed.level === 'poll') {
      // A feed that only polls sends no wake-up: the retake is the next poll of w2, and it falls
      // due when w2's clock has passed one poll (1 s, at most 20 % longer with jitter).
      clock.advance(1_200);
    }
    // On a feed that wakes, the wake-up the release records (its queue is proved by job-wake-cases)
    // alone makes w2 retake the job at its still clock.
    await k.reached(() => k.runs.length === 2);
    expect(k.runs.map((run) => [run.worker, run.attempt])).toEqual([
      ['w1', 1],
      ['w2', 1],
    ]);
    k.resume(1);
    await k.reached(() => k.runs[0]?.end === 'refused' && k.runs[1]?.end === 'completed');
    expect(await k.written()).toEqual(['1/1']);
  });
}
