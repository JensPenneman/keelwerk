import type { StoredJobSpec } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { jobStoreHelpers } from './job-store-helpers.ts';

const { tenantA, tenantB } = conformanceScopes;
const namespaceScope = { level: 'namespace', reason: 'conformance' } as const;

/** Erasure's job purge (14.7.5 step 5a): the jobs of a subject's principals, against every adapter. */
export function jobPurgeCases(subject: Pick<ConformanceSubject, 'run' | 'clock'>): void {
  const { take, enqueue, only, numbered } = jobStoreHelpers(subject);
  const now = (): Temporal.Instant => subject.clock?.now() ?? Temporal.Now.instant();
  const by = (principalId: string, n: number, over: Partial<StoredJobSpec> = {}): StoredJobSpec =>
    numbered(n, { principal: { resolver: 'conf', principalId }, ...over });
  const purged = (ids: readonly string[], scope = tenantA) =>
    subject.run(scope, (unit) => unit.jobs.purgeForPrincipals(ids, ['commands', 'timers']));
  const purge = async (ids: readonly string[], scope = tenantA): Promise<number> =>
    (await purged(ids, scope)).length;
  const queued = async (): Promise<number> => {
    const [row] = await subject.run(namespaceScope, (unit) => unit.jobs.stats('commands'));
    return row?.queued ?? 0;
  };

  describe('job purge (14.7.5)', () => {
    test('purges the queued, scheduled, waiting and dead jobs the principals run as and leaves the others', async () => {
      const chain = (principal: string, n: number) =>
        by(principal, n, {
          key: { value: `chain-${principal}`, onConflict: 'append' },
          ordering: 'fifo-per-key',
        });
      await enqueue([
        by('gone', 1),
        by('gone', 2, { runAt: now().add({ hours: 1 }) }),
        chain('gone', 3),
        chain('gone', 4),
        by('kept', 5),
        chain('kept', 6),
        chain('kept', 7),
      ]);
      expect(await queued()).toBe(7);
      expect(await purge(['gone'])).toBe(4);
      expect(await queued()).toBe(3);
      const taken = await take('w1', { limit: 10 });
      expect(taken.map((job) => ('input' in job.run ? job.run.input : null)).sort()).toEqual([
        5, 6,
      ]);
      expect(await purge(['gone'])).toBe(0);
    });

    test('a job the principal caused, run by another principal, is kept', async () => {
      await enqueue([
        numbered(1, {
          principal: { resolver: 'conf', principalId: 'module.system' },
          causation: { actor: { kind: 'user', id: 'gone', via: 'conf' } },
        }),
        by('kept', 2),
      ]);
      expect(await purge(['gone'])).toBe(0);
      expect(await queued()).toBe(2);
    });

    test('only command jobs and timers are purged: a reaction, an effect or another queue is kept', async () => {
      await enqueue([
        by('gone', 1, { queue: 'timers', runAt: now().add({ hours: 1 }) }),
        by('gone', 2),
        by('gone', 3, { queue: 'reactions' }),
        by('gone', 4, { queue: 'module.mail' }),
        by('gone', 5, { kind: 'effect', run: { executor: 'mail.smtp', effect: 'e1' } }),
      ]);
      const jobs = await purged(['gone']);
      expect(jobs.map((job) => job.queue).sort()).toEqual(['commands', 'timers']);
      expect(await purge(['gone'])).toBe(0);
    });

    test("an erasure job of the principal is kept, whatever its state, and another command of the principal's is purged", async () => {
      const erasure = (n: number, over: Partial<StoredJobSpec> = {}) =>
        by('gone', n, {
          run: { action: 'core.eraseSubject', input: n, commandId: `erase-${n}` },
          ...over,
        });
      await enqueue([
        erasure(1),
        erasure(2, { runAt: now().add({ hours: 1 }) }),
        erasure(3, {
          key: { value: 'erasures', onConflict: 'append' },
          ordering: 'fifo-per-key',
        }),
        erasure(4, {
          key: { value: 'erasures', onConflict: 'append' },
          ordering: 'fifo-per-key',
        }),
        by('gone', 5),
      ]);
      expect(
        (await purged(['gone'])).map((job) => ('input' in job.run ? job.run.input : null)),
      ).toEqual([5]);
      expect(await queued()).toBe(4);
      expect(await purge(['gone'])).toBe(0);
    });

    test('answers what the purged jobs ran, so the value keys of their secret members can go', async () => {
      await enqueue([by('gone', 7), by('kept', 8)]);
      const [job] = await purged(['gone']);
      expect(job).toMatchObject({
        queue: 'commands',
        run: { action: expect.any(String), input: 7 },
      });
    });

    test('a dead job of the principal is purged too', async () => {
      await enqueue([by('gone', 1)]);
      const job = only(await take('w1', { limit: 1 }));
      expect(
        await subject.run(namespaceScope, (unit) =>
          unit.jobs.complete(job.attempt, 'w1', {
            kind: 'dead',
            error: {
              kind: 'unavailable',
              code: 'core.unavailable',
              message: 'down',
              retryable: true,
              requestId: 'r',
            },
          }),
        ),
      ).toBe(true);
      expect(await purge(['gone'])).toBe(1);
    });

    test('a running job stays and another scope is not touched', async () => {
      await enqueue([by('gone', 1)]);
      const running = only(await take('w1', { limit: 1 }));
      await enqueue([by('gone', 2)], tenantB);
      expect(await purge(['gone'])).toBe(0);
      expect(await purge(['gone'], tenantB)).toBe(1);
      expect(
        await subject.run(namespaceScope, (unit) =>
          unit.jobs.complete(running.attempt, 'w1', { kind: 'succeeded' }),
        ),
      ).toBe(true);
    });

    test('the next waiting job of a key is released when its head is purged', async () => {
      const chain = (principal: string, n: number) =>
        by(principal, n, {
          key: { value: 'shared', onConflict: 'append' },
          ordering: 'fifo-per-key',
        });
      await enqueue([chain('gone', 1), chain('kept', 2)]);
      expect(await purge(['gone'])).toBe(1);
      const taken = only(await take('w1', { limit: 5 }));
      expect('input' in taken.run ? taken.run.input : null).toBe(2);
    });
  });
}
