import type { JobOutcome, StoredJob, WireError } from '@keelwerk/core';
import { expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { conformanceWait } from './conformance-wait.ts';
import { jobStoreHelpers } from './job-store-helpers.ts';
import { storedJob } from './stored-job.ts';

const namespaceScope = { level: 'namespace', reason: 'conformance' } as const;
const unavailable: WireError = {
  kind: 'unavailable',
  code: 'core.unavailable',
  message: 'down',
  retryable: true,
  requestId: 'r',
};
const dead: JobOutcome = { kind: 'dead', error: unavailable };

/**
 * The lost leases of a job a receipt may hang on, an action job whose run carries a command id
 * (9.5.4, D7), against the job store of every adapter: the store never ends it for lost leases,
 * however often they were lost, because only its taker can end it together with its receipt. The
 * end of any other job at the third loss is a row of `jobStoreCases`.
 */
export function jobStoreLostLeaseCases(subject: Pick<ConformanceSubject, 'run' | 'clock'>): void {
  const wait = conformanceWait(subject);
  const { take, enqueue, finish, only } = jobStoreHelpers(subject);
  const command = () =>
    storedJob({
      run: { action: 'a', input: 1, commandId: 'c1' },
      causation: { commandId: 'c1' },
    });
  /** Takes the job with a lease of one millisecond and lets it pass. */
  const lose = async (worker: string): Promise<StoredJob> => {
    const job = only(await take(worker, { leaseMs: 1 }));
    await wait(25);
    return job;
  };

  test('the third lost lease of a command job leaves it takeable and exhausted for its taker', async () => {
    await enqueue([command()]);
    expect((await lose('w1')).leasesExhausted).toBeUndefined();
    expect((await lose('w2')).leasesExhausted).toBeUndefined();
    expect((await lose('w3')).leasesExhausted).toBeUndefined();
    const fourth = only(await take('w4', { leaseMs: 60_000 }));
    expect(fourth.leasesExhausted).toBe(true);
    expect(fourth.attempt.attempt).toBe(4);
    expect(await finish(fourth, 'w4', dead)).toBe(true);
    expect(await take('w5')).toEqual([]);
  });

  test('a command job whose taker never ends it is handed out again however often its leases are lost', async () => {
    await enqueue([command()]);
    // Far past the third loss, where any other job is a dead letter, and past any bound a store
    // might set for a taker that never ends the job.
    for (const loss of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const job = await lose(`w${loss}`);
      expect(job.leasesExhausted, `take ${loss}`).toBe(loss > 3 ? true : undefined);
    }
    const last = only(await take('w13', { leaseMs: 60_000 }));
    expect(last.leasesExhausted).toBe(true);
    expect(await finish(last, 'w13', dead)).toBe(true);
    expect(await take('w14')).toEqual([]);
    const stats = await subject.run(namespaceScope, (unit) => unit.jobs.stats('commands'));
    expect(stats.map((row) => [row.due, row.running])).toEqual([[0, 0]]);
  });
}
