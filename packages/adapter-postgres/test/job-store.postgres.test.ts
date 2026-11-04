// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { JobStore, StorageScope, StoredJob, StoredJobSpec } from '@keelwerk/core';
import { jobStoreCases } from '@keelwerk/testing';
import { describe, expect, test } from 'vitest';
import { eventHarness } from './support/event-harness.ts';
import { taggedUnit } from './support/tagged-unit.ts';
import { testScopes } from './support/test-scopes.ts';

const { backendId } = testScopes;
const { adapter, clock, run, owner } = eventHarness('job_store', 16);
const namespaceScope: StorageScope = { level: 'namespace', reason: 'test' };

const tenant = (n: number): Extract<StorageScope, { level: 'tenant' }> => ({
  level: 'tenant',
  backendId,
  tenantId: `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`,
});

const spec = (n: number, over: Partial<StoredJobSpec> = {}): StoredJobSpec => ({
  queue: 'commands',
  run: { action: 'a', input: n },
  scope: tenant(0),
  principal: { resolver: 'system', principalId: 'p' },
  causation: {},
  build: { id: 'b1', revision: 1 },
  kind: 'action',
  laneCap: 10,
  createdAt: Temporal.Instant.from('2026-01-01T00:00:00Z'),
  ...over,
});

const takeRequest = (limit: number, leaseMs = 60_000) => ({
  limit,
  capabilitySets: [''],
  maxRevision: 100,
  leaseMs,
});

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A unit that names itself in `application_name`, so a stuck statement shows who ran it. */
const tagged = <T>(label: string, fn: (jobs: JobStore) => Promise<T>): Promise<T> =>
  taggedUnit(adapter(), clock, namespaceScope, `job-store:${label}`, async (unit) => fn(unit.jobs));

async function enqueueFor(n: number, jobs: readonly StoredJobSpec[]): Promise<void> {
  await run(tenant(n), async (unit) => {
    for (const job of jobs) await unit.jobs.enqueue({ ...job, scope: tenant(n) });
  });
}

/** Lanes whose running attempts (taken less done) exceed their cap. */
const overCap = async (): Promise<number> =>
  owner(async (client) => {
    const result = await client.query<{ n: number }>(
      `select count(*)::int as n from app.kw_job_lanes l
       join app.kw_job_lane_counts d on d.lane_id = l.id and d.kind = 'done' where l.taken - d.value > l.cap`,
    );
    return result.rows[0]?.n ?? 0;
  });

describe('the queue scenarios of the conformance suite on PostgreSQL 18', () => {
  jobStoreCases({ run, clock });
});

describe('takers in parallel', () => {
  test('lane caps hold and no job is taken twice while four takers and a sampler run', async () => {
    const tenants = [1, 2, 3, 4, 5, 6, 7, 8];
    for (const n of tenants) {
      await enqueueFor(
        n,
        [1, 2, 3, 4, 5, 6].map((job) => spec(n * 10 + job, { laneCap: 2 })),
      );
    }
    const seen = new Set<string>();
    let over = 0;
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        over += await overCap();
        await pause(2);
      }
    })();
    for (let round = 0; round < 3; round += 1) {
      const taken = await Promise.all(
        [0, 1, 2, 3].map(async (taker) => {
          const mine: StoredJob[] = [];
          for (let attempt = 0; attempt < 6; attempt += 1) {
            const result = await tagged(`take-${round}-${taker}`, (jobs) =>
              jobs.take('commands', `w${taker}`, takeRequest(4)),
            );
            mine.push(...result.jobs);
            await pause(1);
          }
          return mine;
        }),
      );
      const all = taken.flat();
      for (const job of all) {
        expect(seen.has(job.id)).toBe(false);
        seen.add(job.id);
      }
      expect(all).toHaveLength(tenants.length * 2);
      await Promise.all(
        all.map(async (job) =>
          tagged('complete', (jobs) =>
            jobs.complete(job.attempt, `w${taken.findIndex((mine) => mine.includes(job))}`, {
              kind: 'succeeded',
            }),
          ),
        ),
      );
    }
    sampling = false;
    await sampler;
    expect(seen.size).toBe(tenants.length * 6);
    expect(over).toBe(0);
    expect(await overCap()).toBe(0);
    const [left] = await owner(
      async (client) => (await client.query(`select count(*)::int as n from app.kw_jobs`)).rows,
    );
    expect(left).toEqual({ n: 0 });
  });

  test('a group limit holds across takers that run at the same time', async () => {
    const group = { id: 'mx:shared', concurrency: 3, scope: 'namespace' } as const;
    await run(namespaceScope, (unit) => unit.jobs.provisionGroup(group));
    for (const n of [1, 2, 3, 4, 5, 6]) {
      await enqueueFor(n, [spec(n, { group }), spec(n + 100, { group })]);
    }
    const results = await Promise.all(
      [0, 1, 2, 3, 4, 5].map(async (taker) =>
        tagged(`group-${taker}`, (jobs) => jobs.take('commands', `w${taker}`, takeRequest(4))),
      ),
    );
    expect(results.flatMap((result) => result.jobs)).toHaveLength(3);
    const [counters] = await owner(
      async (client) =>
        (await client.query(`select running, scope_id from app.kw_job_groups`)).rows,
    );
    expect(counters).toEqual({ running: 3, scope_id: null });
  });

  test('a take reports lanes another taker holds as skipped, apart from "no work"', async () => {
    await enqueueFor(1, [spec(1)]);
    const inner = await tagged('holder', async (jobs) => {
      const held = await jobs.take('commands', 'holder', takeRequest(5));
      expect(held.jobs).toHaveLength(1);
      await enqueueFor(2, [spec(2)]);
      return tagged('skipper', (other) => other.take('commands', 'skipper', takeRequest(5)));
    });
    expect(inner.jobs.map((job) => job.run)).toEqual([{ action: 'a', input: 2 }]);
    expect(inner.skippedLanes).toBe(1);
    const stuck = await tagged('holder-2', async (jobs) => {
      await enqueueFor(3, [spec(3)]);
      const held = await jobs.take('commands', 'holder', takeRequest(5));
      expect(held.jobs).toHaveLength(1);
      return tagged('skipper-2', (other) => other.take('commands', 'skipper', takeRequest(5)));
    });
    expect(stuck.jobs).toEqual([]);
    expect(stuck.skippedLanes).toBe(1);
  });
});

describe('what is written', () => {
  test('history never holds the input, and a dead letter keeps it', async () => {
    await enqueueFor(1, [spec(1, { run: { action: 'a', input: { secret: 'x' } } }), spec(2)]);
    const taken = await tagged('take', (jobs) => jobs.take('commands', 'w', takeRequest(5)));
    const [first, second] = taken.jobs;
    const error = {
      kind: 'unavailable',
      code: 'core.unavailable',
      message: 'down',
      retryable: true,
      requestId: 'r',
    } as const;
    await tagged('dead', (jobs) =>
      jobs.complete((first as StoredJob).attempt, 'w', { kind: 'dead', error }),
    );
    await tagged('ok', (jobs) =>
      jobs.complete((second as StoredJob).attempt, 'w', { kind: 'succeeded' }),
    );
    const kept = await owner(async (client) => ({
      jobs: (await client.query(`select state, input from app.kw_jobs`)).rows,
      history: (
        await client.query(
          `select outcome, attempts, started_at is not null as started, error from app.kw_job_history order by job_id`,
        )
      ).rows,
      columns: (
        await client.query(
          `select column_name from information_schema.columns where table_schema = 'app' and table_name = 'kw_job_history'`,
        )
      ).rows.map((row) => row.column_name),
    }));
    expect(kept.jobs).toEqual([{ state: 'dead', input: { action: 'a', input: { secret: 'x' } } }]);
    expect(kept.history).toEqual([
      { outcome: 'dead', attempts: 1, started: true, error },
      { outcome: 'succeeded', attempts: 1, started: true, error: null },
    ]);
    expect(kept.columns).not.toContain('input');
  });
});
