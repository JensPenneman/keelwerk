import { conformanceScopes } from '@keelwerk/data/conformance';
import { expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { jobStoreHelpers } from './job-store-helpers.ts';

const { tenantA, tenantB } = conformanceScopes;

/**
 * The weight of a lane (12.2, 9.5.3): a lane of weight 2 takes two jobs for every one of a lane of
 * weight 1, a spec without a weight gives a new lane weight 1 and leaves an existing lane's weight
 * as it is, against the job store of every adapter.
 */
export function jobStoreLaneWeightCases(subject: Pick<ConformanceSubject, 'run'>): void {
  const { take, enqueue, only, numbered } = jobStoreHelpers(subject);
  const firstSix = async (): Promise<number> => {
    let ofA = 0;
    for (const worker of ['w1', 'w2', 'w3', 'w4', 'w5', 'w6']) {
      const job = only(await take(worker, { limit: 1 }));
      if (job.scope.level === 'tenant' && job.scope.tenantId === tenantA.tenantId) ofA += 1;
    }
    return ofA;
  };

  test('a lane of weight 2 takes four of the first six jobs against a lane without laneWeight', async () => {
    await enqueue([1, 2, 3, 4, 5, 6].map((n) => numbered(n, { laneWeight: 2 })));
    await enqueue(
      [7, 8, 9, 10, 11, 12].map((n) => numbered(n)),
      tenantB,
    );
    expect(await firstSix()).toBe(4);
  });

  test('an enqueue with another weight changes the lane, one without laneWeight keeps it', async () => {
    await enqueue([numbered(1), numbered(2), numbered(3)]);
    await enqueue([4, 5, 6].map((n) => numbered(n, { laneWeight: 2 })));
    await enqueue([numbered(7)]);
    await enqueue(
      [8, 9, 10, 11, 12, 13].map((n) => numbered(n)),
      tenantB,
    );
    expect(await firstSix()).toBe(4);
  });

  test('a taken job carries no laneWeight member', async () => {
    await enqueue([numbered(1, { laneWeight: 2 })]);
    const job = only(await take('w1', { limit: 1 }));
    expect('laneWeight' in job).toBe(false);
  });
}
