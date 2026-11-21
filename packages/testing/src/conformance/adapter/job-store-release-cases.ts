import type { JobAttempt, JobOutcome, StorageScope, WireError } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { jobStoreHelpers } from './job-store-helpers.ts';

const { tenantA, tenantB } = conformanceScopes;
const namespaceScope: StorageScope = { level: 'namespace', reason: 'conformance' };
const unavailable: WireError = {
  kind: 'unavailable',
  code: 'core.unavailable',
  message: 'down',
  retryable: true,
  requestId: 'r',
};
const succeeded: JobOutcome = { kind: 'succeeded' };

/**
 * `JobStore.release` (21.6 step 4) on every adapter: a running attempt goes back to `available` with
 * its attempt given back, conditional on (worker, attempt); its lane and group give their room back,
 * the lost-lease count stays, and a tenant unit reaches only its own scope.
 */
export function jobStoreReleaseCases(subject: Pick<ConformanceSubject, 'run' | 'clock'>): void {
  const { take, enqueue, finish, only, inputs, numbered } = jobStoreHelpers(subject);
  const clock = () => {
    if (subject.clock === undefined) throw new Error('the release cases need a movable clock');
    return subject.clock;
  };
  const release = (
    attempts: readonly JobAttempt[],
    worker: string,
    scope: StorageScope = namespaceScope,
  ): Promise<readonly JobAttempt[]> =>
    subject.run(scope, (unit) => unit.jobs.release(attempts, worker));
  const heartbeat = (
    attempts: readonly JobAttempt[],
    worker: string,
  ): Promise<readonly JobAttempt[]> =>
    subject.run(namespaceScope, (unit) => unit.jobs.heartbeat(attempts, worker, 60_000));

  test('release gives a running attempt back to available, and the next take hands it out under the same number', async () => {
    await enqueue([numbered(1)]);
    const first = only(await take('w1'));
    expect(first.attempt.attempt).toBe(1);
    expect(await take('w2')).toEqual([]);
    expect(await release([first.attempt], 'w1')).toEqual([first.attempt]);
    const second = only(await take('w2'));
    expect(second.attempt).toEqual(first.attempt);
    expect(inputs([second])).toEqual([1]);
    expect(await finish(second, 'w2', succeeded)).toBe(true);
  });

  test('release is conditional on the worker and the attempt; a released attempt can neither renew nor complete', async () => {
    await enqueue([numbered(1)]);
    const first = only(await take('w1'));
    expect(await release([first.attempt], 'w2')).toEqual([]);
    expect(await release([{ ...first.attempt, attempt: first.attempt.attempt + 1 }], 'w1')).toEqual(
      [],
    );
    expect(await release([{ jobId: 'not-a-number', attempt: 1 }], 'w1')).toEqual([]);
    expect(await release([], 'w1')).toEqual([]);
    expect(await heartbeat([first.attempt], 'w1')).toEqual([first.attempt]);
    expect(await release([first.attempt], 'w1')).toEqual([first.attempt]);
    expect(await release([first.attempt], 'w1')).toEqual([]);
    expect(await heartbeat([first.attempt], 'w1')).toEqual([]);
    expect(await finish(first, 'w1', succeeded)).toBe(false);
    const again = only(await take('w2'));
    expect(await finish(again, 'w2', succeeded)).toBe(true);
    expect(await release([again.attempt], 'w2')).toEqual([]);
  });

  test('release keeps the lost-lease count: two losses, a release and one more loss make a dead letter', async () => {
    await enqueue([numbered(1)]);
    const lease = 60_000;
    only(await take('w1', { leaseMs: lease }));
    clock().advance(lease + 1000);
    const second = only(await take('w2', { leaseMs: lease }));
    expect(second.attempt.attempt).toBe(2);
    clock().advance(lease + 1000);
    const third = only(await take('w3', { leaseMs: lease }));
    expect(third.attempt.attempt).toBe(3);
    expect(await release([third.attempt], 'w3')).toEqual([third.attempt]);
    const fourth = only(await take('w4', { leaseMs: lease }));
    expect(fourth.attempt.attempt).toBe(3);
    clock().advance(lease + 1000);
    expect(await take('w5', { leaseMs: lease })).toEqual([]);
    expect(await finish(fourth, 'w4', succeeded)).toBe(false);
    const purged = await subject.run(tenantA, (unit) =>
      unit.jobs.purgeForPrincipals(['p'], ['commands']),
    );
    expect(purged.map((job) => ('input' in job.run ? job.run.input : null))).toEqual([1]);
  });

  test('release gives the group slot and the lane room back', async () => {
    const grouped = (n: number) =>
      numbered(n, { laneCap: 1, group: { id: 'release-group', concurrency: 1 } });
    await enqueue([grouped(1), grouped(2)]);
    const first = only(await take('w1'));
    expect(inputs([first])).toEqual([1]);
    expect(await take('w2')).toEqual([]);
    expect(await release([first.attempt], 'w1')).toEqual([first.attempt]);
    const next = only(await take('w2'));
    expect(inputs([next])).toEqual([1]);
    expect(next.attempt.attempt).toBe(1);
    expect(await take('w3')).toEqual([]);
    expect(await finish(next, 'w2', succeeded)).toBe(true);
    expect(inputs(await take('w3'))).toEqual([2]);
  });

  test('a tenant unit releases only its own scope', async () => {
    await enqueue([numbered(1)], tenantA);
    const job = only(await take('w1'));
    expect(await release([job.attempt], 'w1', tenantB)).toEqual([]);
    expect(await take('w2')).toEqual([]);
    expect(await release([job.attempt], 'w1', tenantA)).toEqual([job.attempt]);
    expect(inputs(await take('w2'))).toEqual([1]);
  });

  test('a failed job is not released: the attempt that ended answers nothing', async () => {
    await enqueue([numbered(1)]);
    const job = only(await take('w1'));
    expect(await finish(job, 'w1', { kind: 'failed', error: unavailable })).toBe(true);
    expect(await release([job.attempt], 'w1')).toEqual([]);
  });
}
