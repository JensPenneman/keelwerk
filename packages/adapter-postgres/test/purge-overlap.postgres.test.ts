import type { PurgeBatch, StorageScope, Unit } from '@keelwerk/core';
import { CompiledQuery } from 'kysely';
import { describe, expect, test } from 'vitest';
import { newEvent } from './support/event-fixtures.ts';
import { purgeReceiptOf } from './support/purge-receipt-of.ts';
import { purgeStreamOf } from './support/purge-stream-of.ts';
import { storeHarness } from './support/store-harness.ts';
import { testScopes } from './support/test-scopes.ts';

const { scopeA } = testScopes;
const { run, runSql } = storeHarness('purge_overlap');
const stamp = Temporal.Instant.from('2026-01-01T00:00:00Z');
const far = stamp.add({ hours: 1000 });
const candidates = 24;

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until some backend of this database waits for a row lock, which is where a purge stands that another purge holds rows from. */
async function untilSomeoneWaits(scope: StorageScope): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const found = await runSql(scope, async (unit) =>
      unit.db.executeQuery<{ n: number }>(
        CompiledQuery.raw(
          `select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
        ),
      ),
    );
    if ((found.rows[0]?.n ?? 0) > 0) return;
    await pause(50);
  }
  throw new Error('no purge came to wait for the rows of the other');
}

/**
 * Two purges of one scope with 24 candidates: the second takes its oldest ten while the first holds
 * the oldest five deleted but not committed, so it deletes five and leaves 14. Answers both.
 */
async function overlapping(
  purge: (unit: Unit, limit: number) => Promise<PurgeBatch>,
): Promise<{ readonly held: PurgeBatch; readonly waited: PurgeBatch }> {
  const deleted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const held = run(scopeA, async (unit) => {
    const answer = await purge(unit, 5);
    deleted.resolve();
    await release.promise;
    return answer;
  });
  await deleted.promise;
  const waited = run(scopeA, (unit) => purge(unit, 10));
  await untilSomeoneWaits(scopeA);
  release.resolve();
  return { held: await held, waited: await waited };
}

describe('two purges of one scope at once on PostgreSQL 18', () => {
  test('a transient purge that skipped rows the other took says candidates are left', async () => {
    const stream = purgeStreamOf(1, scopeA);
    // The receipt lives, so the newest record stays and 24 are candidates.
    await run(scopeA, (unit) => unit.receipts.put(purgeReceiptOf('c1')));
    await run(scopeA, (unit) =>
      unit.events.append([
        {
          stream: { type: 'core.commandReceipt', id: stream },
          expectedVersion: 0,
          partition: null,
          tenancy: 'invocation',
          events: Array.from({ length: candidates + 1 }, (_, n) => ({
            ...newEvent(n + 1),
            recordedAt: stamp.add({ hours: n + 1 }),
            transient: true,
          })),
        },
      ]),
    );
    const { held, waited } = await overlapping((unit, limit) =>
      unit.events.purgeTransient(far, limit, ['core.commandReceipt']),
    );
    expect(held).toEqual({ removed: 5, more: true });
    // Short of its limit of ten, and still fourteen left: the size of the batch says nothing.
    expect(waited).toEqual({ removed: 5, more: true });
  });

  test('a history purge that skipped rows the other took says rows are left', async () => {
    await runSql(scopeA, async (unit) => {
      await unit.db.executeQuery(
        CompiledQuery.raw(
          `insert into app.kw_job_history (scope_id, job_id, queue, kind, outcome, attempts, finished_at)
           select $1::uuid, n, 'q', 'k', 'succeeded', 1, $2::timestamptz + n * interval '1 hour'
           from generate_series(1, $3::int) as n`,
          [testScopes.tenantA, stamp.toString(), candidates],
        ),
      );
    });
    const { held, waited } = await overlapping((unit, limit) => unit.jobs.purgeHistory(far, limit));
    expect(held).toEqual({ removed: 5, more: true });
    expect(waited).toEqual({ removed: 5, more: true });
  });
});
