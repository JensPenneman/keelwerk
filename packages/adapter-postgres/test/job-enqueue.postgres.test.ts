// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { Scope, StorageScope, StoredJobSpec } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { streamAppend } from './support/event-fixtures.ts';
import { eventHarness } from './support/event-harness.ts';
import { testScopes } from './support/test-scopes.ts';

const { scopeA, scopeB, tenantA, tenantB } = testScopes;
const { run, failure, owner } = eventHarness('job_enqueue', 12);

const spec = (scope: StorageScope, over: Partial<StoredJobSpec> = {}): StoredJobSpec => ({
  queue: 'commands',
  run: { action: 'app.note.set', input: { n: 1 } },
  scope: scope as Scope,
  principal: { resolver: 'system', principalId: 'p' },
  causation: {},
  build: { id: 'b1', revision: 1 },
  kind: 'action',
  laneCap: 10,
  createdAt: Temporal.Instant.from('2026-01-01T00:00:00Z'),
  ...over,
});

const countsOf = (): Promise<readonly { scope_id: string; kind: string; value: number }[]> =>
  owner(
    async (client) =>
      (
        await client.query<{ scope_id: string; kind: string; value: number }>(
          `select scope_id, kind, value::int as value from app.kw_job_lane_counts order by scope_id, kind`,
        )
      ).rows,
  );

describe('enqueue under forced row-level security', () => {
  test('the lane counter moves in a tenant unit, for that tenant only', async () => {
    const forced = await owner(async (client) =>
      (
        await client.query<{ relname: string; relforcerowsecurity: boolean }>(
          `select relname, relforcerowsecurity from pg_class
           where relnamespace = 'app'::regnamespace and relname in ('kw_jobs', 'kw_job_lanes', 'kw_job_lane_counts', 'kw_events')
           order by relname`,
        )
      ).rows.map((row) => [row.relname, row.relforcerowsecurity]),
    );
    expect(forced).toEqual([
      ['kw_events', true],
      ['kw_job_lane_counts', true],
      ['kw_job_lanes', true],
      ['kw_jobs', true],
    ]);
    await run(scopeA, async (u) => {
      await u.jobs.enqueue(spec(scopeA));
      await u.jobs.enqueue(spec(scopeA, { runAt: Temporal.Instant.from('2999-01-01T00:00:00Z') }));
    });
    await run(scopeB, (u) => u.jobs.enqueue(spec(scopeB)));
    expect(await countsOf()).toEqual([
      { scope_id: tenantA, kind: 'done', value: 0 },
      { scope_id: tenantA, kind: 'enqueued', value: 1 },
      { scope_id: tenantB, kind: 'done', value: 0 },
      { scope_id: tenantB, kind: 'enqueued', value: 1 },
    ]);
  });

  test('a counter row the unit cannot move fails the unit instead of losing the count', async () => {
    await run(scopeA, (u) => u.jobs.enqueue(spec(scopeA)));
    await owner(async (client) => {
      await client.query(`delete from app.kw_job_lane_counts where kind = 'enqueued'`);
    });
    const failed = await failure(run(scopeA, (u) => u.jobs.enqueue(spec(scopeA))));
    expect(failed.kind).toBe('internal');
    const jobs = await owner(async (client) =>
      Number(
        (await client.query<{ n: string }>('select count(*) as n from app.kw_jobs')).rows[0]?.n,
      ),
    );
    expect(jobs).toBe(1);
  });

  test('a unit that appends and enqueues moves the position counter and the lane in one tail', async () => {
    await run(scopeA, async (u) => {
      await u.events.append([streamAppend(1, [1, 2])]);
      await u.jobs.enqueue(spec(scopeA));
    });
    expect(await countsOf()).toEqual([
      { scope_id: tenantA, kind: 'done', value: 0 },
      { scope_id: tenantA, kind: 'enqueued', value: 1 },
    ]);
    expect(await run(scopeA, (u) => u.events.head())).toBe(2n);
  });
});

describe('concurrent enqueues', () => {
  test('units of one scope that create the same lane at once end with one lane and every job counted', async () => {
    await Promise.all(
      Array.from({ length: 8 }, async () => run(scopeA, (u) => u.jobs.enqueue(spec(scopeA)))),
    );
    const lanes = await owner(async (client) =>
      Number(
        (await client.query<{ n: string }>('select count(*) as n from app.kw_job_lanes')).rows[0]
          ?.n,
      ),
    );
    expect(lanes).toBe(1);
    expect(await countsOf()).toEqual([
      { scope_id: tenantA, kind: 'done', value: 0 },
      { scope_id: tenantA, kind: 'enqueued', value: 8 },
    ]);
  });

  test('units that enqueue one key with `keep` end with one job and the same id', async () => {
    const ids = await Promise.all(
      Array.from({ length: 6 }, async () =>
        run(scopeA, (u) =>
          u.jobs.enqueue(spec(scopeA, { key: { value: 'k', onConflict: 'keep' } })),
        ),
      ),
    );
    expect(new Set(ids).size).toBe(1);
    expect(await countsOf()).toEqual([
      { scope_id: tenantA, kind: 'done', value: 0 },
      { scope_id: tenantA, kind: 'enqueued', value: 1 },
    ]);
  });

  test('units that enqueue one key with `replace` leave one pending job and a history row per replaced one', async () => {
    await Promise.all(
      Array.from({ length: 5 }, async (_, n) =>
        run(scopeA, (u) =>
          u.jobs.enqueue(
            spec(scopeA, {
              run: { action: 'a', input: n },
              key: { value: 'k', onConflict: 'replace' },
            }),
          ),
        ),
      ),
    );
    const [jobs, history] = await owner(async (client) => [
      Number(
        (await client.query<{ n: string }>('select count(*) as n from app.kw_jobs')).rows[0]?.n,
      ),
      Number(
        (
          await client.query<{ n: string }>(
            `select count(*) as n from app.kw_job_history where outcome = 'cancelled'`,
          )
        ).rows[0]?.n,
      ),
    ]);
    expect([jobs, history]).toEqual([1, 4]);
    expect((await countsOf()).find((count) => count.kind === 'enqueued')?.value).toBe(1);
  });
});
