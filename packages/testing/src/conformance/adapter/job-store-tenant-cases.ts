import type { JobOutcome, Unit } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { jobStoreHelpers } from './job-store-helpers.ts';

const { tenantB } = conformanceScopes;
const namespaceScope = { level: 'namespace', reason: 'conformance' } as const;
const succeeded: JobOutcome = { kind: 'succeeded' };

/**
 * The fair order of lanes of equal load and the isolation of the queue between tenants (9.5.3,
 * 14.3.9), against the job store of every adapter.
 */
export function jobStoreTenantCases(subject: Pick<ConformanceSubject, 'run'>): void {
  const { take, enqueue, finish, only, inputs, numbered } = jobStoreHelpers(subject);
  test('lanes of equal load alternate, one job at a time', async () => {
    await enqueue([1, 2, 3].map((n) => numbered(n)));
    await enqueue(
      [4, 5, 6].map((n) => numbered(n)),
      tenantB,
    );
    const order: string[] = [];
    for (const worker of ['w1', 'w2', 'w3', 'w4', 'w5', 'w6']) {
      const job = only(await take(worker, { limit: 1 }));
      order.push(JSON.stringify(job.scope));
      expect(await finish(job, worker, succeeded)).toBe(true);
    }
    expect(new Set(order).size).toBe(2);
    for (const [index, scope] of order.entries()) {
      if (index > 0) expect(scope).not.toBe(order[index - 1]);
    }
  });

  test('a unit of another tenant reaches neither the job, its lease nor its statistics', async () => {
    await enqueue([numbered(1), numbered(2)]);
    const job = only(await take('w1', { limit: 1 }));
    const inB = <T>(fn: (unit: Unit) => Promise<T>): Promise<T> => subject.run(tenantB, fn);
    expect(await inB((unit) => unit.jobs.complete(job.attempt, 'w1', succeeded))).toBe(false);
    expect(await inB((unit) => unit.jobs.heartbeat([job.attempt], 'w1', 60_000))).toEqual([]);
    expect(await inB((unit) => unit.jobs.stats())).toEqual([]);
    expect(await inB((unit) => unit.jobs.promote('commands', 10))).toBe(0);
    const foreign = await inB(
      async (unit) =>
        (
          await unit.jobs.take('commands', 'w2', {
            limit: 10,
            capabilitySets: [''],
            maxRevision: 100,
            leaseMs: 60_000,
          })
        ).jobs,
    );
    expect(foreign).toEqual([]);
    expect(
      await subject.run(namespaceScope, (unit) => unit.jobs.heartbeat([job.attempt], 'w1', 60_000)),
    ).toEqual([job.attempt]);
    expect(await finish(job, 'w1', succeeded)).toBe(true);
    expect(inputs(await take('w3'))).toEqual([2]);
  });
}
