import type { StoredJob, WireError } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';
import { jobStoreHelpers } from './job-store-helpers.ts';

const { tenantA, tenantB } = conformanceScopes;
const unavailable: WireError = {
  kind: 'unavailable',
  code: 'core.unavailable',
  message: 'down',
  retryable: true,
  requestId: 'r',
};

/**
 * `JobStore.purgeHistory` (14.7.1), against every adapter: the history rows of the unit's scope
 * finished before an instant go, lowest job id first up to the limit; the jobs table and another
 * scope's history stay.
 */
export function jobHistoryPurgeCases(
  subject: Pick<ConformanceSubject, 'run' | 'read' | 'clock'>,
): void {
  const { take, enqueue, finish, numbered } = jobStoreHelpers(subject);
  const now = (): Temporal.Instant => subject.clock?.now() ?? Temporal.Now.instant();
  const later = (): Temporal.Instant => now().add({ hours: 1 });
  const purgeBatch = (before: Temporal.Instant, limit: number, scope = tenantA) =>
    subject.run(scope, (unit) => unit.jobs.purgeHistory(before, limit));
  const purge = async (before: Temporal.Instant, limit: number, scope = tenantA): Promise<number> =>
    (await purgeBatch(before, limit, scope)).removed;
  /** Enqueues `count` jobs in the scope, takes and finishes them all, which writes one history row each. */
  const finished = async (
    count: number,
    outcome: 'succeeded' | 'dead' = 'succeeded',
    scope = tenantA,
  ): Promise<void> => {
    await enqueue(
      Array.from({ length: count }, (_, index) => numbered(index + 1)),
      scope,
    );
    const taken = await take('w1', { limit: count });
    for (const job of taken as readonly StoredJob[]) {
      await finish(
        job,
        'w1',
        outcome === 'succeeded' ? { kind: 'succeeded' } : { kind: 'dead', error: unavailable },
      );
    }
  };

  describe('job history purge (14.7.1)', () => {
    test('removes history rows finished before the instant, up to the limit', async () => {
      await finished(3);
      expect(await purge(now().subtract({ hours: 1 }), 10)).toBe(0);
      expect(await purge(later(), 2)).toBe(2);
      expect(await purge(later(), 10)).toBe(1);
      expect(await purge(later(), 10)).toBe(0);
    });

    test('says whether a row is left, from what is stored and not from the batch size', async () => {
      await finished(3);
      expect(await purgeBatch(now().subtract({ hours: 1 }), 10)).toEqual({
        removed: 0,
        more: false,
      });
      expect(await purgeBatch(later(), 2)).toEqual({ removed: 2, more: true });
      expect(await purgeBatch(later(), 1)).toEqual({ removed: 1, more: false });
      expect(await purgeBatch(later(), 1)).toEqual({ removed: 0, more: false });
    });

    test('leaves kw_jobs rows, dead letters included', async () => {
      await finished(2, 'dead');
      expect(await purge(later(), 10)).toBe(2);
      const kept = await subject.run(tenantA, (unit) =>
        unit.jobs.purgeForPrincipals(['p'], ['commands']),
      );
      expect(kept).toHaveLength(2);
    });

    test("leaves another scope's history", async () => {
      await finished(2, 'succeeded', tenantA);
      await finished(1, 'succeeded', tenantB);
      expect(await purge(later(), 10, tenantB)).toBe(1);
      expect(await purge(later(), 10, tenantA)).toBe(2);
    });

    test('refuses a read-only unit and a limit outside 1 to 100000', async () => {
      expect(
        await failureOf(subject.read(tenantA, (unit) => unit.jobs.purgeHistory(later(), 10))),
      ).toEqual({ kind: 'internal', code: 'core.internal' });
      for (const limit of [0, 100_001]) {
        expect(await failureOf(purge(later(), limit))).toEqual({
          kind: 'validation',
          code: 'core.malformed_request',
        });
      }
    });

    test('is refused in a namespace-scope unit', async () => {
      const refusal = await failureOf(
        subject.run({ level: 'namespace', reason: 'conformance' }, (unit) =>
          unit.jobs.purgeHistory(later(), 10),
        ),
      );
      expect(refusal).toEqual({ kind: 'internal', code: 'core.internal' });
    });
  });
}
