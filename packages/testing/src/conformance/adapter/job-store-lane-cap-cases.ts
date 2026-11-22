import type { Scope } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { jobStoreHelpers } from './job-store-helpers.ts';

const { tenantA } = conformanceScopes;

/**
 * The cap of a lane (9.5.2): a lane never runs more jobs than its cap, a cap of 0 holds the lane
 * (nothing of it is taken), and a cap that is not a whole number from 0 to 2147483647 is refused
 * with `core.malformed_request` before anything is written, against the job store of every adapter.
 */
export function jobStoreLaneCapCases(subject: Pick<ConformanceSubject, 'run'>): void {
  const { take, enqueue, numbered } = jobStoreHelpers(subject);

  test('a cap that is not a whole number from 0 to 2147483647 is refused and a unit that catches it has written nothing', async () => {
    await enqueue([1, 2, 3, 4, 5].map((n) => numbered(n, { laneCap: 2 })));
    // The unit ends normally, so a rollback cannot undo what a refused enqueue wrote: only a
    // refusal that comes before every write leaves the lane and the queue as they were.
    const caught = await subject.run(tenantA, async (unit) => {
      const errors: unknown[] = [];
      for (const laneCap of [-1, 1.5, Number.NaN, 2_147_483_648, Number.POSITIVE_INFINITY]) {
        try {
          await unit.jobs.enqueue({ ...numbered(99, { laneCap }), scope: tenantA as Scope });
        } catch (error) {
          errors.push(error);
        }
      }
      return errors;
    });
    expect(caught).toHaveLength(5);
    for (const error of caught) expect(error).toMatchObject({ code: 'core.malformed_request' });
    // The lane still has cap 2: a take of ten gets two jobs.
    expect(await take('w1', { limit: 10 })).toHaveLength(2);
    // A new cap of 10 leaves room for the three that are left and the job enqueued with it: the
    // five jobs are all that was stored before, so no refused job (the number 99) was written.
    await enqueue([numbered(6, { laneCap: 10 })]);
    expect(await take('w2', { limit: 10 })).toHaveLength(4);
  });

  test('a cap of 0 holds the lane and the largest cap is accepted', async () => {
    await enqueue([numbered(1, { laneCap: 0 })]);
    expect(await take('w1', { limit: 10 })).toHaveLength(0);
    await enqueue([numbered(2, { laneCap: 2_147_483_647 })]);
    expect(await take('w2', { limit: 10 })).toHaveLength(2);
  });
}
