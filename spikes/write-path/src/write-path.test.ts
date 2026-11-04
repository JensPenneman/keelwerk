import { setTimeout as delay } from 'node:timers/promises';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendCommand } from './append-command.ts';
import type { AppendRequest } from './append-request.ts';
import { CoalescingNotifier } from './coalescing-notifier.ts';
import { connect } from './connect.ts';
import { errorCode } from './error-code.ts';
import { fairTake } from './fair-take.ts';
import { namespaceRoot as ns } from './namespace-root.ts';
import type { RunningPostgres } from './running-postgres.ts';
import { seedLanes } from './seed-lanes.ts';
import { seedScopes } from './seed-scopes.ts';
import type { SeededScope } from './seeded-scope.ts';
import { startPostgres } from './start-postgres.ts';

let postgres: RunningPostgres;
let admin: Client;
let nextScope = 1000;
const seed = async (entities = 8): Promise<SeededScope> => {
  nextScope += 1;
  return (await seedScopes(admin, nextScope, 1, entities))[0] as SeededScope;
};
const request = (scope: SeededScope, target: string): AppendRequest => ({
  scope,
  target,
  loads: [],
  isolation: 'read committed',
  positionedLoads: true,
  targetPosition: 'same-statement',
  tail: 'statements',
  enqueueLane: undefined,
  notifyInTransaction: false,
  auditTargetPosition: false,
});
const tenantUnit = async (client: Client, scope: SeededScope): Promise<void> => {
  await client.query('begin');
  await client.query(`select set_config('keelwerk.tenant_id', $1, true)`, [scope.id]);
};

beforeAll(async () => {
  postgres = await startPostgres();
  admin = await connect(postgres.admin, 'test-admin');
});
afterAll(async () => {
  await admin?.end();
  await postgres?.stop();
});

describe('commit tail (section 15.1.4)', () => {
  it.each(['statements', 'single-statement'] as const)(
    'gives gapless positions that readers only ever see as a complete prefix (%s)',
    async (tail) => {
      const scope = await seed();
      const writers = await Promise.all(
        scope.entities.map((_, index) => connect(postgres.app, `w:${scope.index}:${index}`)),
      );
      const reader = await connect(postgres.app, 'reader');
      let writing = true;
      const prefixes: boolean[] = [];
      const read = (async (): Promise<void> => {
        while (writing) {
          await tenantUnit(reader, scope);
          const seen = await reader.query<{ n: number; head: number }>(
            `select count(*)::int as n, coalesce(max(position), 0)::int as head from ${ns}.kw_events`,
          );
          await reader.query('commit');
          prefixes.push(seen.rows[0]?.n === seen.rows[0]?.head);
        }
      })();
      await Promise.all(
        writers.map(async (client, index) => {
          for (let round = 0; round < 25; round += 1) {
            await appendCommand(client, { ...request(scope, scope.entities[index] ?? ''), tail });
          }
        }),
      );
      writing = false;
      await read;
      await Promise.all([...writers, reader].map((client) => client.end()));
      const events = await admin.query<{ position: number; version: number }>(
        `select position::int as position, stream_version as version from ${ns}.kw_events
         where scope_id = $1 order by position`,
        [scope.id],
      );
      expect(events.rows.map((row) => row.position)).toEqual(
        Array.from({ length: 200 }, (_, index) => index + 1),
      );
      const counter = await admin.query<{ next: number }>(
        `select next::int as next from ${ns}.kw_positions where scope_id = $1`,
        [scope.id],
      );
      expect(counter.rows[0]?.next).toBe(201);
      expect(prefixes.length).toBeGreaterThan(0);
      expect(prefixes.every(Boolean)).toBe(true);
    },
  );

  it("never makes one tenant's writer wait on another tenant's tail", async () => {
    const [held, free] = [await seed(), await seed()];
    const blocker = await connect(postgres.app, 'blocker');
    const writer = await connect(postgres.app, 'writer');
    await tenantUnit(blocker, held);
    await blocker.query(`update ${ns}.kw_positions set next = next where scope_id = $1`, [held.id]);
    const started = performance.now();
    await appendCommand(writer, request(free, free.entities[0] ?? ''));
    const elapsed = performance.now() - started;
    await blocker.query('commit');
    await Promise.all([blocker.end(), writer.end()]);
    // The bound proves the absence of the 1.5 s wait, not the latency.
    expect(elapsed).toBeLessThan(1_000);
  });

  it('fails a concurrent append of the same stream version with 23505', async () => {
    const scope = await seed();
    const insert = `insert into ${ns}.kw_events (scope_id, position, backend_id, stream_type, stream_id,
      stream_version, event_id, name, shape_id, data, meta, hlc, recorded_at)
      values ($1, $2, $1, 'demo.item', $3, 1, gen_random_uuid(), 'created', '\\x00', '{}', '{}', '0', now())`;
    await admin.query(insert, [scope.id, 1, scope.entities[0]]);
    const duplicate = await admin.query(insert, [scope.id, 2, scope.entities[0]]).catch(errorCode);
    expect(duplicate).toBe('23505');
  });
});

describe('snapshot positions of loads (sections 7.9.4, 26.2 item 6)', () => {
  it('fails a REPEATABLE READ unit at the tail once another unit of its scope committed', async () => {
    const scope = await seed();
    const [slow, fast] = await Promise.all([
      connect(postgres.app, 'slow'),
      connect(postgres.app, 'fast'),
    ]);
    await slow.query('begin isolation level repeatable read');
    await slow.query(`select set_config('keelwerk.tenant_id', $1, true)`, [scope.id]);
    await slow.query(`select next from ${ns}.kw_positions where scope_id = $1`, [scope.id]);
    await appendCommand(fast, request(scope, scope.entities[1] ?? ''));
    const failure = await slow
      .query(`update ${ns}.kw_positions set next = next + 1 where scope_id = $1`, [scope.id])
      .catch(errorCode);
    await slow.query('rollback');
    await Promise.all([slow.end(), fast.end()]);
    expect(failure).toBe('40001');
  });

  it('tags a locked load with a stale position after a lock wait unless read after the lock', async () => {
    const scope = await seed();
    const target = scope.entities[0] ?? '';
    const [holder, waiter] = await Promise.all([
      connect(postgres.app, 'holder'),
      connect(postgres.app, 'waiter'),
    ]);
    const positioned = `select version, (select next - 1 from ${ns}.kw_positions where scope_id = $1)::int as at
      from ${ns}.demo__item where tenant_id = $1 and id = $2 for update`;
    await tenantUnit(holder, scope);
    await holder.query(positioned, [scope.id, target]);
    await tenantUnit(waiter, scope);
    const waiting = waiter.query<{ version: number; at: number }>(positioned, [scope.id, target]);
    await delay(100);
    await holder.query(`update ${ns}.demo__item set version = 1 where tenant_id = $1 and id = $2`, [
      scope.id,
      target,
    ]);
    await holder.query(`update ${ns}.kw_positions set next = next + 1 where scope_id = $1`, [
      scope.id,
    ]);
    await holder.query('commit');
    const loaded = (await waiting).rows[0];
    const after = await waiter.query<{ at: number }>(
      `select next::int - 1 as at from ${ns}.kw_positions where scope_id = $1`,
      [scope.id],
    );
    await waiter.query('rollback');
    await Promise.all([holder.end(), waiter.end()]);
    // The row is the holder's version 1, written at position 1, but the subselect kept the
    // statement's snapshot from before the wait: position 0.
    expect(loaded).toEqual({ version: 1, at: 0 });
    expect(after.rows[0]?.at).toBe(1);
  });
});

describe('row-level security settings (section 14.3.7)', () => {
  it("leaves '' behind after a tenant unit, which the specification's policy cast rejects", async () => {
    const scope = await seed();
    const client = await connect(postgres.app, 'pooled');
    await appendCommand(client, request(scope, scope.entities[0] ?? ''));
    const setting = await client.query<{ value: string | null }>(
      `select current_setting('keelwerk.tenant_id', true) as value`,
    );
    const cast = await client
      .query(`select current_setting('keelwerk.tenant_id', true)::uuid`)
      .catch(errorCode);
    const visible = await client.query<{ n: number }>(
      `select count(*)::int as n from ${ns}.kw_events`,
    );
    await client.end();
    expect(setting.rows[0]?.value).toBe('');
    expect(cast).toBe('22P02');
    expect(visible.rows[0]?.n).toBe(0);
  });
});

describe('job store (sections 9.5.3, 14.3.9)', () => {
  it('spreads a batch over lanes and holds lane caps under concurrent takers', async () => {
    const queue = 'test-caps';
    const lanes = await seedLanes(admin, {
      queue,
      capabilitySet: 'default',
      lanes: 3,
      jobsPerLane: 10,
      cap: 2,
    });
    const takers = await Promise.all(
      Array.from({ length: 6 }, (_, index) => connect(postgres.app, `taker-${index}`)),
    );
    const take = (client: Client, worker: string, batch: number) =>
      fairTake(client, {
        queue,
        worker,
        capabilitySets: ['default'],
        batch,
        lanes: batch,
        maxRevision: 1,
        leaseMs: 30_000,
      });
    const first = await take(takers[0] as Client, 'first', 3);
    expect(first.jobs.map((job) => job.laneId).sort()).toEqual([...lanes].sort());
    const rest = await Promise.all(
      takers.map((client, index) => take(client, `taker-${index}`, 10)),
    );
    await Promise.all(takers.map((client) => client.end()));
    const running = await admin.query<{ lane: string; n: number }>(
      `select lane_id::text as lane, count(*)::int as n from ${ns}.kw_jobs
       where queue = $1 and state = 'running' group by lane_id order by lane_id`,
      [queue],
    );
    expect(running.rows.map((row) => row.n)).toEqual([2, 2, 2]);
    expect(first.jobs.length + rest.reduce((total, taken) => total + taken.jobs.length, 0)).toBe(6);
  });
});

describe('notifier (section 14.3.7)', () => {
  it('wakes a LISTEN connection after commit with the namespace and its scopes', async () => {
    const [sender, listener] = await Promise.all([
      connect(postgres.app, 'notifier'),
      connect(postgres.app, 'listener'),
    ]);
    const received: string[] = [];
    listener.on('notification', (message) => received.push(message.payload ?? ''));
    await listener.query('listen kw_events');
    const notifier = new CoalescingNotifier(
      async (payload) => {
        await sender.query('select pg_notify($1, $2)', ['kw_events', payload]);
      },
      { intervalMs: 50, maxPayloadBytes: 7999 },
    );
    notifier.committed(ns, 'a');
    notifier.committed(ns, 'b');
    await notifier.flush();
    await listener.query('select 1');
    await Promise.all([sender.end(), listener.end()]);
    expect(received).toEqual([`${ns}:a,b`]);
  });
});
