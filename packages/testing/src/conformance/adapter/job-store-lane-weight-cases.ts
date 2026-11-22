import type { Scope } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { jobStoreHelpers } from './job-store-helpers.ts';

const { tenantA, tenantB } = conformanceScopes;

/**
 * The weight of a lane (12.2, 9.5.3): a lane of weight 2 takes two jobs for every one of a lane of
 * weight 1, a spec without a weight gives a new lane weight 1 and leaves an existing lane's weight
 * as it is, and a weight that is not a whole number from 1 to 2147483647 is refused before anything
 * is written, against the job store of every adapter.
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

  test('a weight that is not a whole number from 1 to 2147483647 is refused and writes nothing', async () => {
    await enqueue([numbered(1, { laneWeight: 2 })]);
    for (const laneWeight of [0, -1, 1.5, 2_147_483_648, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(enqueue([numbered(2, { laneWeight })])).rejects.toMatchObject({
        code: 'core.malformed_request',
      });
    }
    // The refused enqueues left neither a job nor a changed lane: job 1 is the only job, and the
    // lane still has weight 2 against a lane of weight 1 (four of the first six jobs).
    await enqueue([2, 3, 4, 5, 6].map((n) => numbered(n, { laneWeight: 2 })));
    await enqueue(
      [7, 8, 9, 10, 11, 12].map((n) => numbered(n)),
      tenantB,
    );
    expect(await firstSix()).toBe(4);
    const rest = await take('w7', { limit: 10 });
    expect(rest).toHaveLength(6);
  });

  test('a refusal that the unit catches and then commits has written nothing: the lane keeps its weight and no job is stored', async () => {
    await enqueue([1, 2, 3, 4, 5, 6].map((n) => numbered(n, { laneWeight: 2 })));
    // The unit ends normally, so a rollback cannot undo what the refused enqueues wrote: only a
    // refusal that comes before every write leaves the lane and the queue as they were.
    const caught = await subject.run(tenantA, async (unit) => {
      const errors: unknown[] = [];
      for (const laneWeight of [0, 1.5, 2_147_483_648]) {
        try {
          await unit.jobs.enqueue({ ...numbered(99, { laneWeight }), scope: tenantA as Scope });
        } catch (error) {
          errors.push(error);
        }
      }
      return errors;
    });
    expect(caught).toHaveLength(3);
    for (const error of caught) expect(error).toMatchObject({ code: 'core.malformed_request' });
    await enqueue(
      [7, 8, 9, 10, 11, 12].map((n) => numbered(n)),
      tenantB,
    );
    // The lane of tenant A still has weight 2 against a lane of weight 1 (four of the first six
    // jobs). The twelve jobs enqueued are all that is stored: six are left after the first six, so
    // no refused job (the number 99 of the refusals) was written.
    expect(await firstSix()).toBe(4);
    expect(await take('w7', { limit: 10 })).toHaveLength(6);
  });

  test('a weight of 1 and the largest weight are accepted', async () => {
    await enqueue([numbered(1, { laneWeight: 1 })]);
    await enqueue([numbered(2, { laneWeight: 2_147_483_647 })]);
    expect(await take('w1', { limit: 10 })).toHaveLength(2);
  });
}
