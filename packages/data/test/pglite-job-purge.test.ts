// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { StoredJob } from '@keelwerk/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { finishJob } from './support/finish-job.ts';
import { unavailable } from './support/job-fixtures.ts';
import { jobSpec } from './support/job-spec.ts';
import { ownerRows } from './support/owner-rows.ts';
import { restartJobIds } from './support/restart-job-ids.ts';
import { stamp } from './support/stamp.ts';
import { storeSuite } from './support/store-suite.ts';
import { takeJobs } from './support/take-jobs.ts';
import { tenantScope } from './support/tenant-scope.ts';

const store = storeSuite();
const rows = async (sql: string): Promise<readonly Record<string, unknown>[]> =>
  ownerRows(store.adapter, sql);
const by = (principalId: string, over: Parameters<typeof jobSpec>[0] = {}) =>
  jobSpec({ principal: { resolver: 'system', principalId }, ...over });
const purge = async (ids: readonly string[]): Promise<number> =>
  (
    await store.run(tenantScope, (unit) =>
      unit.jobs.purgeForPrincipals(ids, ['commands', 'timers']),
    )
  ).length;

beforeEach(async () => {
  await restartJobIds(store.adapter);
});

describe('the history a job purge writes (14.7.5 step 5a)', () => {
  test('a queued, a scheduled and a waiting job each leave one `cancelled` row without input or error', async () => {
    const chain = (n: number) =>
      by('gone', {
        key: { value: 'chain', onConflict: 'append' },
        ordering: 'fifo-per-key',
        run: { action: 'app.note.set', input: { n } },
      });
    await store.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(by('gone'));
      await unit.jobs.enqueue(by('gone', { runAt: stamp.add({ hours: 1 }) }));
      await unit.jobs.enqueue(chain(1));
      await unit.jobs.enqueue(chain(2));
      await unit.jobs.enqueue(by('kept'));
    });
    expect(await purge(['gone'])).toBe(4);
    const history = await rows(
      'select job_id::int as job_id, outcome, started_at, error from app.kw_job_history order by job_id',
    );
    expect(history).toHaveLength(4);
    for (const row of history) {
      expect(row).toMatchObject({ outcome: 'cancelled', started_at: null, error: null });
      expect(Object.keys(row)).not.toContain('input');
    }
    // The job of another principal is untouched and has no history.
    expect(await rows('select count(*)::int as n from app.kw_jobs')).toEqual([{ n: 1 }]);
  });

  test('a dead job of the principal is deleted and keeps only the `dead` row it already had', async () => {
    await store.run(tenantScope, (unit) => unit.jobs.enqueue(by('gone')));
    const [job] = await takeJobs(store, 'w1', {});
    expect(
      await finishJob(store, job as StoredJob, 'w1', { kind: 'dead', error: unavailable }),
    ).toBe(true);
    expect(await purge(['gone'])).toBe(1);
    expect(await rows('select outcome from app.kw_job_history')).toEqual([{ outcome: 'dead' }]);
    expect(await rows('select id from app.kw_jobs')).toEqual([]);
  });
});
