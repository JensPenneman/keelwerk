// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { Scope } from '@keelwerk/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { backendScope } from './support/backend-scope.ts';
import { failure } from './support/failure.ts';
import { jobSpec } from './support/job-spec.ts';
import { namespaceScope } from './support/namespace-scope.ts';
import { newEvent } from './support/new-event.ts';
import { ownerRows } from './support/owner-rows.ts';
import { restartJobIds } from './support/restart-job-ids.ts';
import { stamp } from './support/stamp.ts';
import { storeSuite } from './support/store-suite.ts';
import { tenantScope } from './support/tenant-scope.ts';
import { tenantTwo } from './support/tenant-two.ts';

const store = storeSuite();

beforeEach(async () => {
  await restartJobIds(store.adapter);
});

const rows = async (sql: string): Promise<readonly Record<string, unknown>[]> =>
  ownerRows(store.adapter, sql);

const counts = (): Promise<readonly Record<string, unknown>[]> =>
  rows(
    `select l.queue, l.priority, l.capability_set, l.cap, l.weight, c.kind, c.value::int as value
     from app.kw_job_lanes l join app.kw_job_lane_counts c on c.lane_id = l.id
     order by l.id, c.kind`,
  );

const states = async (): Promise<readonly unknown[]> =>
  (await rows('select id::int as id, state, key from app.kw_jobs order by id')).map((row) => [
    row.id,
    row.state,
    row.key,
  ]);

describe('enqueue and the lane counts', () => {
  test('a due job is available and counted at the tail; a later one is scheduled and not counted', async () => {
    const ids = await store.run(tenantScope, async (unit) => [
      await unit.jobs.enqueue(jobSpec({ laneCap: 4 })),
      await unit.jobs.enqueue(jobSpec({ laneCap: 4, runAt: stamp.add({ seconds: 60 }) })),
    ]);
    expect(ids).toEqual(['1', '2']);
    expect(await states()).toEqual([
      [1, 'available', null],
      [2, 'scheduled', null],
    ]);
    expect(await counts()).toEqual([
      {
        queue: 'commands',
        priority: 1,
        capability_set: '',
        cap: 4,
        weight: 1,
        kind: 'done',
        value: 0,
      },
      {
        queue: 'commands',
        priority: 1,
        capability_set: '',
        cap: 4,
        weight: 1,
        kind: 'enqueued',
        value: 1,
      },
    ]);
  });

  test('a lane is one row per queue, capability set and priority; its cap follows the newest enqueue', async () => {
    await store.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(jobSpec({ laneCap: 4 }));
      await unit.jobs.enqueue(jobSpec({ laneCap: 6 }));
      await unit.jobs.enqueue(jobSpec({ priority: 'high' }));
      await unit.jobs.enqueue(jobSpec({ capability: ['b', 'a', 'a'] }));
    });
    expect(
      await rows(
        `select queue, priority, capability_set, cap from app.kw_job_lanes order by priority, capability_set`,
      ),
    ).toEqual([
      { queue: 'commands', priority: 0, capability_set: '', cap: 10 },
      { queue: 'commands', priority: 1, capability_set: '', cap: 6 },
      { queue: 'commands', priority: 1, capability_set: 'a,b', cap: 10 },
    ]);
    expect(
      await rows(`select sum(value)::int as n from app.kw_job_lane_counts where kind = 'enqueued'`),
    ).toEqual([{ n: 4 }]);
  });

  test('every column of the spec is stored, the input and principal as JSON', async () => {
    await store.run(tenantScope, (unit) =>
      unit.jobs.enqueue(
        jobSpec({
          run: { action: 'app.note.set', input: { n: 1 } },
          apiVersion: '2026-01-01',
          cost: 3,
          ordering: 'fifo-per-key',
          key: { value: 'k', onConflict: 'keep' },
          group: { id: 'mx', concurrency: 2, rate: '60/1m' },
          retry: { delays: 'exponential', limit: 5 },
          heartbeatSeconds: 20,
          expireInSeconds: 90,
          deadLetter: 'dead',
        }),
      ),
    );
    const [job] = await rows(
      `select scope_id, queue, kind, state, principal, causation, build_id, revision, api_version, ordering,
        group_id, group_spec, key, cost, retry, heartbeat_seconds, expire_in_seconds, dead_letter, input,
        created_at from app.kw_jobs`,
    );
    const tenantId = tenantScope.level === 'tenant' ? tenantScope.tenantId : '';
    expect(job).toMatchObject({
      scope_id: tenantId,
      queue: 'commands',
      kind: 'action',
      state: 'available',
      principal: { resolver: 'system', principalId: 'p' },
      causation: {},
      build_id: 'b1',
      revision: 1,
      api_version: '2026-01-01',
      ordering: 'fifo-per-key',
      group_id: 'mx',
      group_spec: { id: 'mx', concurrency: 2, rate: '60/1m' },
      key: 'k',
      cost: 3,
      retry: { delays: 'exponential', limit: 5 },
      heartbeat_seconds: 20,
      expire_in_seconds: 90,
      dead_letter: 'dead',
      input: { action: 'app.note.set', input: { n: 1 } },
    });
    expect(new Date(String(job?.created_at)).toISOString()).toBe(
      stamp.toString({ smallestUnit: 'millisecond' }),
    );
    expect(
      await rows('select id, scope_id, concurrency, running, rate, tokens from app.kw_job_groups'),
    ).toEqual([
      {
        id: 'mx',
        scope_id: tenantId,
        concurrency: 2,
        running: 0,
        rate: '60/1m',
        tokens: 60,
      },
    ]);
  });

  test('a group that spans the namespace has no scope; a namespace unit creates and re-limits it, tenants only read it', async () => {
    const spec = { id: 'mx:example.com', scope: 'namespace' as const };
    const provision = (concurrency: number) =>
      store.run(namespaceScope, (unit) => unit.jobs.provisionGroup({ ...spec, concurrency }));
    await provision(1);
    await store.run(tenantScope, (unit) =>
      unit.jobs.enqueue(jobSpec({ group: { ...spec, concurrency: 5 } })),
    );
    await store.run(tenantTwo, (unit) =>
      unit.jobs.enqueue(jobSpec({ scope: tenantTwo as Scope, group: { ...spec, concurrency: 7 } })),
    );
    expect(await rows('select id, scope_id, concurrency from app.kw_job_groups')).toEqual([
      { id: 'mx:example.com', scope_id: null, concurrency: 1 },
    ]);
    await provision(3);
    expect(await rows('select id, scope_id, concurrency from app.kw_job_groups')).toEqual([
      { id: 'mx:example.com', scope_id: null, concurrency: 3 },
    ]);
  });

  test('only a namespace unit provisions a group, and only a namespace group', async () => {
    const group = { id: 'mx:example.com', scope: 'namespace' as const };
    expect(
      (await failure(store.run(tenantScope, (unit) => unit.jobs.provisionGroup(group)))).kind,
    ).toBe('internal');
    expect(
      (await failure(store.run(namespaceScope, (unit) => unit.jobs.provisionGroup({ id: 'mx' }))))
        .kind,
    ).toBe('internal');
    expect(await rows('select id from app.kw_job_groups')).toEqual([]);
  });

  test('an enqueue from a tenant unit into a namespace group nobody provisioned fails and writes nothing', async () => {
    const refused = await failure(
      store.run(tenantScope, (unit) =>
        unit.jobs.enqueue(jobSpec({ group: { id: 'mx:missing', scope: 'namespace' } })),
      ),
    );
    expect(refused.kind).toBe('internal');
    expect(await rows('select id from app.kw_job_groups')).toEqual([]);
    expect(await states()).toEqual([]);
  });

  test('a rolled-back unit enqueues and counts nothing, a savepoint likewise', async () => {
    await store
      .run(tenantScope, async (unit) => {
        await unit.jobs.enqueue(jobSpec());
        throw new Error('boom');
      })
      .catch(() => undefined);
    expect(await states()).toEqual([]);
    await store.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(jobSpec({ key: { value: 'a', onConflict: 'keep' } }));
      await unit
        .nested(async (inner) => {
          await inner.jobs.enqueue(jobSpec({ key: { value: 'b', onConflict: 'keep' } }));
          throw new Error('undo');
        })
        .catch(() => undefined);
    });
    // An identity value taken in a rolled-back savepoint is not given back, so the id is not asserted.
    expect((await states()).map((job) => (job as unknown[]).slice(1))).toEqual([
      ['available', 'a'],
    ]);
    expect(
      await rows(`select value::int as n from app.kw_job_lane_counts where kind = 'enqueued'`),
    ).toEqual([{ n: 1 }]);
  });

  test('a job of another scope is refused, so is any enqueue from a read-only or namespace unit', async () => {
    expect((await failure(store.run(tenantTwo, (unit) => unit.jobs.enqueue(jobSpec())))).code).toBe(
      'core.forbidden',
    );
    expect(
      (await failure(store.run(backendScope, (unit) => unit.jobs.enqueue(jobSpec())))).code,
    ).toBe('core.forbidden');
    expect(
      (await failure(store.run(namespaceScope, (unit) => unit.jobs.enqueue(jobSpec())))).code,
    ).toBe('core.forbidden');
    expect(
      (await failure(store.read(tenantScope, (unit) => unit.jobs.enqueue(jobSpec())))).kind,
    ).toBe('internal');
    expect(
      (
        await failure(
          store.run(tenantScope, (unit) =>
            unit.jobs.enqueue(jobSpec({ group: { id: 'g', scope: 'deployment' } })),
          ),
        )
      ).kind,
    ).toBe('unsupported');
  });

  test('a unit that appends events and enqueues moves the position counter and the lane in one tail', async () => {
    await store.run(tenantScope, async (unit) => {
      await unit.jobs.enqueue(jobSpec());
      await unit.events.append([
        {
          stream: { type: 'app.note', id: '00000000-0000-7000-8000-000000000001' },
          expectedVersion: 0,
          partition: null,
          events: [newEvent(1)],
        },
      ]);
    });
    expect(await rows('select next::int as next from app.kw_positions')).toEqual([{ next: 2 }]);
    expect(
      await rows(`select value::int as n from app.kw_job_lane_counts where kind = 'enqueued'`),
    ).toEqual([{ n: 1 }]);
  });
});
