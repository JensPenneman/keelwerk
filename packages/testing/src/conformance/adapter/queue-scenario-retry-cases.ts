import { isKeelwerkError } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import type { QueueScenarioKit } from './queue-scenario-kit.ts';

const { tenantA } = conformanceScopes;

/** Retries, dead letters and the expiry of an attempt (9.5.4, 14.3.9), through the kernel queue. */
export function queueScenarioRetryCases(
  kit: () => QueueScenarioKit,
  subject: Pick<ConformanceSubject, 'run'>,
): void {
  /** The attempt ended and its retry (or its end) is stored: nothing runs, one job waits. */
  const retryStored = (k: QueueScenarioKit) => async (): Promise<boolean> => {
    const stats = await k.stats();
    return stats !== undefined && stats.running === 0 && stats.queued === 1;
  };

  test('a retryable failure is retried by the policy, the attempt counted', {
    timeout: 60_000,
  }, async () => {
    const k = kit();
    await k.enqueue([k.job(1, { retry: { delays: ['1s'], limit: 3 } })]);
    k.script(1, ['fail', 'succeed']);
    await k.worker('w1');
    await k.until(retryStored(k));
    k.clock().advance(2_000);
    await k.until(() => k.runs.length === 2 && k.runs.every((run) => run.end !== 'running'));
    expect(k.runs.map((run) => run.attempt)).toEqual([1, 2]);
    expect(k.runs.map((run) => run.end)).toEqual(['failed', 'completed']);
    expect(await k.written()).toEqual(['1/2']);
  });

  test('out of retries with a dead-letter target the job is a dead letter that keeps its input', {
    timeout: 60_000,
  }, async () => {
    const k = kit();
    await k.enqueue([k.job(1, { retry: { delays: ['1s'], limit: 2 }, deadLetter: 'dlq' })]);
    k.script(1, ['fail']);
    await k.worker('w1');
    await k.until(retryStored(k));
    k.clock().advance(2_000);
    await k.until(async () => {
      const stats = await k.stats();
      return k.runs.length === 2 && stats?.running === 0 && stats.due === 0 && stats.queued === 0;
    });
    expect(await k.probeTake()).toEqual([]);
    const purged = await subject.run(tenantA, (unit) =>
      unit.jobs.purgeForPrincipals(['p'], ['scenarios']),
    );
    expect(purged).toEqual([{ queue: 'scenarios', run: { action: 'scenario.run', input: 1 } }]);
  });

  test('a handler that resumes after its attempt expired writes nothing, and the job is retried', {
    timeout: 60_000,
  }, async () => {
    const k = kit();
    await k.enqueue([k.job(1, { expireInSeconds: 5 })]);
    k.script(1, ['holdInUnit', 'succeed']);
    await k.worker('w1');
    await k.until(() => k.runs.length === 1);
    k.clock().advance(6_000);
    await k.until(() => k.runs[0]?.abortReason !== undefined);
    const reason = k.runs[0]?.abortReason;
    expect(isKeelwerkError(reason) && reason.code).toBe('core.timeout');
    k.resume(1);
    await k.until(retryStored(k));
    expect(await k.written()).toEqual([]);
    k.clock().advance(2_000);
    await k.until(() => k.runs.length === 2 && k.runs[1]?.end === 'completed');
    expect(k.runs.map((run) => run.attempt)).toEqual([1, 2]);
    expect(await k.written()).toEqual(['1/2']);
  });
}
