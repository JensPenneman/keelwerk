import { startPostgres } from '@keelwerk/testing/postgres';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { applyFrameworkTables } from './support/apply-framework-tables.ts';
import { asBackend } from './support/as-backend.ts';
import { asNamespace } from './support/as-namespace.ts';
import { asTenant } from './support/as-tenant.ts';
import { connect } from './support/connect.ts';
import { enqueueJob } from './support/enqueue-job-seed.ts';
import { groupSeed } from './support/group-seed.ts';
import { laneCounts } from './support/lane-counts-seed.ts';
import { laneSeed } from './support/lane-seed.ts';
import { ns } from './support/ns.ts';
import type { Settings } from './support/settings.ts';
import { tenantA } from './support/tenant-a.ts';
import { tenantB } from './support/tenant-b.ts';
import { unit } from './support/unit.ts';

let postgres: Awaited<ReturnType<typeof startPostgres>>;
let admin: Client;
let app: Client;

beforeAll(async () => {
  postgres = await startPostgres();
  admin = await connect(postgres.adminUrl);
  await applyFrameworkTables(admin);
  app = await connect(postgres.appUrl);
  for (const id of [tenantA, tenantB]) {
    await unit(app, asTenant(id), async () => {
      for (const statement of [laneSeed, groupSeed]) await app.query(statement, [id]);
      await app.query(laneCounts, [id]);
      await app.query(enqueueJob, [id]);
    });
  }
});

afterAll(async () => {
  await app?.end();
  await admin?.end();
  await postgres?.stop();
});

describe('groups and lane counters', () => {
  test('a group without a scope is visible to every unit, a scoped group only to its scope', async () => {
    await unit(app, asNamespace, async () =>
      app.query(`insert into ${ns}.kw_job_groups (id, scope_id) values ('mx:example.com', null)`),
    );
    const ids = async (settings: Settings): Promise<string[]> =>
      unit(app, settings, async () =>
        (
          await app.query<{ id: string }>(`select id from ${ns}.kw_job_groups order by id`)
        ).rows.map((row) => row.id),
      );
    expect(await ids(asTenant(tenantA))).toEqual([`g:${tenantA}`, 'mx:example.com']);
    expect(await ids(asBackend)).toEqual(['mx:example.com']);
    expect(await ids(asNamespace)).toHaveLength(3);
  });

  test('the lane count bump in a tenant unit moves the counter (decision 116)', async () => {
    const bump = (settings: Settings, scope: string): Promise<number | null> =>
      unit(
        app,
        settings,
        async () =>
          (
            await app.query(
              `update ${ns}.kw_job_lane_counts c set value = c.value + 3
             from ${ns}.kw_job_lanes l where l.id = c.lane_id and l.scope_id = $1 and c.kind = 'enqueued'`,
              [scope],
            )
          ).rowCount,
      );
    expect(await bump(asTenant(tenantA), tenantA)).toBe(1);
    expect(await bump(asBackend, tenantA)).toBe(0);
    const value = await unit(
      app,
      asNamespace,
      async () =>
        (
          await app.query<{ value: string }>(
            `select c.value from ${ns}.kw_job_lane_counts c join ${ns}.kw_job_lanes l on l.id = c.lane_id
           where l.scope_id = $1 and c.kind = 'enqueued'`,
            [tenantA],
          )
        ).rows[0]?.value,
    );
    expect(value).toBe('3');
  });
});

// The statements below are the ones of spikes/write-path/src/{fair-take,complete-jobs}.ts, with the
// spike's namespace replaced by `ns`.
const vmin = `
  select coalesce(min(l.vtime), 0) as vmin from ${ns}.kw_job_lanes l
  join ${ns}.kw_job_lane_counts e on e.lane_id = l.id and e.kind = 'enqueued'
  where l.queue = $1 and l.capability_set = any ($2) and e.value > l.taken`;

const take = `
  with picked as (
    select l.id, l.cap - (l.taken - d.value) as room from ${ns}.kw_job_lanes l
    join ${ns}.kw_job_lane_counts e on e.lane_id = l.id and e.kind = 'enqueued'
    join ${ns}.kw_job_lane_counts d on d.lane_id = l.id and d.kind = 'done'
    where l.queue = $1 and l.capability_set = any ($2) and e.value > l.taken and l.taken - d.value < l.cap
    order by l.priority, (l.taken - d.value) / l.weight, greatest(l.vtime, $3)
    limit $4
    for update of l skip locked
  ), share as (select greatest(1, ceil($5::numeric / nullif(count(*), 0))) as n from picked)
  select j.id::text as id, j.lane_id::text as "laneId", j.scope_id as "scopeId", j.cost, j.attempt
  from picked p cross join share s cross join lateral (
    select * from ${ns}.kw_jobs j
    where j.lane_id = p.id and j.state = 'available' and j.revision <= $6
      and not exists (select 1 from ${ns}.kw_job_groups g where g.id = j.group_id and g.scope_id is not distinct from j.scope_id and g.blocked_until > now())
    order by j.run_at, j.id
    limit least(p.room, s.n)
    for update skip locked) j`;

const running = `
  update ${ns}.kw_jobs set state = 'running', worker = $1, attempt = attempt + 1,
    lease_until = now() + $2 * interval '1 millisecond'
  where id = any ($3::bigint[])`;

const lanes = `
  update ${ns}.kw_job_lanes l set taken = l.taken + x.n, vtime = greatest(l.vtime, $1) + x.cost::double precision / l.weight
  from (select unnest($2::bigint[]) as lane, unnest($3::bigint[]) as n, unnest($4::bigint[]) as cost) x
  where l.id = x.lane`;

const finish = `
  with done as (
    delete from ${ns}.kw_jobs j using unnest($2::bigint[], $3::integer[]) as f (id, attempt)
    where j.id = f.id and j.attempt = f.attempt and j.worker = $1 and j.state = 'running'
    returning j.id, j.scope_id, j.queue, j.attempt
  )
  insert into ${ns}.kw_job_history (job_id, scope_id, queue, outcome, attempts)
  select id, scope_id, queue, 'succeeded', attempt from done`;

const lockCounts = `
  select 1 from ${ns}.kw_job_lane_counts where lane_id = any ($1::bigint[]) and kind = any ($2::text[])
  order by lane_id, kind for update`;

const countDone = `
  update ${ns}.kw_job_lane_counts c set value = c.value + x.n
  from (select unnest($1::bigint[]) as lane, unnest($2::bigint[]) as n) x
  where c.lane_id = x.lane and c.kind = $3`;

interface Taken {
  readonly id: string;
  readonly laneId: string;
  readonly scopeId: string;
  readonly cost: number;
  readonly attempt: number;
}

describe('the spike statements on the framework tables', () => {
  let taken: readonly Taken[] = [];

  test('take runs in a namespace-scope unit', async () => {
    // Make the enqueued counter reflect the one job each tenant has.
    await unit(app, asNamespace, async () =>
      app.query(`update ${ns}.kw_job_lane_counts set value = 1 where kind = 'enqueued'`),
    );
    taken = await unit(app, asNamespace, async () => {
      const sets = ['c'];
      const least = Number(
        (await app.query<{ vmin: number }>(vmin, ['q', sets])).rows[0]?.vmin ?? 0,
      );
      const picked = await app.query<Taken>(take, ['q', sets, least, 10, 10, 1]);
      const jobs = picked.rows.map((job) => ({ ...job, attempt: job.attempt + 1 }));
      await app.query(running, ['w', 10_000, jobs.map((job) => job.id)]);
      const perLane = new Map<string, { n: number; cost: number }>();
      for (const job of jobs) {
        const lane = perLane.get(job.laneId) ?? { n: 0, cost: 0 };
        lane.n += 1;
        lane.cost += job.cost;
        perLane.set(job.laneId, lane);
      }
      await app.query(lanes, [
        least,
        [...perLane.keys()],
        [...perLane.values()].map((lane) => lane.n),
        [...perLane.values()].map((lane) => lane.cost),
      ]);
      return jobs;
    });
    expect(taken).toHaveLength(2);
    expect(taken.map((job) => job.scopeId).sort()).toEqual([tenantA, tenantB]);
    const advanced = await unit(
      app,
      asNamespace,
      async () =>
        (
          await app.query<{ taken: string; vtime: number }>(
            `select taken, vtime from ${ns}.kw_job_lanes`,
          )
        ).rows,
    );
    expect(advanced).toEqual([
      { taken: '1', vtime: 1 },
      { taken: '1', vtime: 1 },
    ]);
  });

  test('completion is a statement of the job tenant unit and moves the counter', async () => {
    for (const tenant of [tenantA, tenantB]) {
      const mine = taken.filter((job) => job.scopeId === tenant);
      expect(mine).toHaveLength(1);
      const laneIds = mine.map((job) => job.laneId);
      const result = await unit(app, asTenant(tenant), async () => {
        const done = await app.query(finish, [
          'w',
          mine.map((job) => job.id),
          mine.map((job) => job.attempt),
        ]);
        await app.query(lockCounts, [laneIds, ['done']]);
        await app.query(countDone, [laneIds, [1], 'done']);
        const history = await app.query<{ outcome: string; attempts: number }>(
          `select outcome, attempts from ${ns}.kw_job_history where job_id = any ($1::bigint[])`,
          [mine.map((job) => job.id)],
        );
        const counter = await app.query<{ value: string }>(
          `select value from ${ns}.kw_job_lane_counts where lane_id = any ($1::bigint[]) and kind = 'done'`,
          [laneIds],
        );
        return { finished: done.rowCount, history: history.rows, counter: counter.rows };
      });
      expect(result.finished).toBe(1);
      expect(result.history).toEqual([{ outcome: 'succeeded', attempts: 1 }]);
      expect(result.counter).toEqual([{ value: '1' }]);
    }
    const open = await unit(
      app,
      asNamespace,
      async () => (await app.query(`select 1 from ${ns}.kw_jobs`)).rowCount,
    );
    expect(open).toBe(0);
  });

  test('a completion in a tenant unit updates its own group under the row lock', async () => {
    const updated = await unit(app, asTenant(tenantA), async () =>
      app.query(`update ${ns}.kw_job_groups set running = running + 1 where id = $1`, [
        `g:${tenantA}`,
      ]),
    );
    expect(updated.rowCount).toBe(1);
  });
});

describe('composite lane keys', () => {
  const laneOf = async (tenant: string): Promise<string> =>
    unit(
      app,
      asTenant(tenant),
      async () =>
        (await app.query<{ id: string }>(`select id::text from ${ns}.kw_job_lanes`)).rows[0]?.id ??
        '',
    );
  const failsForeignKey = async (statement: string, values: unknown[]): Promise<void> => {
    await expect(
      unit(app, asTenant(tenantA), async () => app.query(statement, values)),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(23503|42501)$/) });
  };

  test("a tenant unit cannot attach a job to another tenant's lane", async () => {
    await failsForeignKey(
      `insert into ${ns}.kw_jobs (scope_id, lane_id, queue, kind, state, principal, causation, build_id, revision, input, created_at)
       values ($1, $2, 'q', 'action', 'available', '{}', '{}', 'b', 1, '{}', now())`,
      [tenantA, await laneOf(tenantB)],
    );
  });

  test("a tenant unit cannot attach a count row to another tenant's lane", async () => {
    // A fresh lane has no counters yet, so the primary key cannot answer before the foreign key does.
    const fresh = await unit(
      app,
      asNamespace,
      async () =>
        (
          await app.query<{ id: string }>(
            `insert into ${ns}.kw_job_lanes (scope_id, queue, capability_set, priority, cap, weight)
             values ($1, 'q2', 'c', 1, 5, 1) returning id::text`,
            [tenantB],
          )
        ).rows[0]?.id ?? '',
    );
    await failsForeignKey(
      `insert into ${ns}.kw_job_lane_counts (lane_id, kind, scope_id, value) values ($2, 'enqueued', $1, 0)`,
      [tenantA, fresh],
    );
  });
});
