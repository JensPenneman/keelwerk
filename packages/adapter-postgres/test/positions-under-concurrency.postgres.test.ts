import type { StorageScope } from '@keelwerk/core';
import type { SqlUnit } from '@keelwerk/data';
import { CompiledQuery } from 'kysely';
import { beforeAll, describe, expect, test } from 'vitest';
import type { PostgresAdapterInstance } from '../src/postgres-adapter-instance.ts';
import { newEvent } from './support/event-fixtures.ts';
import { eventHarness } from './support/event-harness.ts';
import { id } from './support/store-rows.ts';
import { taggedUnit } from './support/tagged-unit.ts';
import { testNamespace } from './support/test-namespace.ts';
import { testScopes } from './support/test-scopes.ts';

const { scopeA, scopeB } = testScopes;
const { adapter, clock, owner, spawn } = eventHarness('positions_concurrency', 4);

/** One adapter, so one pool, per tenant: a backend never serves both scopes. */
const tenants: { a?: PostgresAdapterInstance; b?: PostgresAdapterInstance } = {};
beforeAll(async () => {
  tenants.a = await spawn(12);
  tenants.b = await spawn(12);
});

function adapterOf(scope: StorageScope): PostgresAdapterInstance {
  const found = scope === scopeA ? tenants.a : tenants.b;
  if (found === undefined) throw new Error('the tenant adapters are not open');
  return found;
}

const tagged = <T>(
  scope: StorageScope,
  label: string,
  fn: (unit: SqlUnit) => Promise<T>,
): Promise<T> => taggedUnit(adapterOf(scope), clock, scope, label, fn);

/** A small seeded generator, so a run can be repeated. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until `count` backends of scope `a` wait for a lock, which is when the held counter row has its waiters. */
async function waitForLockWaiters(count: number): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const waiting = await owner(async (client) =>
      client.query(
        `select 1 from pg_stat_activity
         where datname = current_database() and application_name = 'kwtest:a'
           and wait_event_type = 'Lock' and state = 'active'`,
      ),
    );
    if (waiting.rowCount === count) return;
    await pause(10);
  }
  throw new Error(`${count} units did not wait for the counter row lock`);
}

/** What the lock sampler saw: waits between units of one scope and between units of two. */
interface Waits {
  samples: number;
  sameScope: number;
  crossScope: number;
  /** The `pg_locks` row of every waiter that waited on the other scope's unit. */
  crossDetails: string[];
}

/** Samples `pg_blocking_pids` on the owner's connection until `stop` is called. */
function sampleWaits(): {
  /** Resolves once the sampler is connected and has taken its first sample. */
  readonly ready: Promise<void>;
  /** The waits seen so far. */
  readonly seen: () => Waits;
  readonly stop: () => Promise<Waits>;
} {
  const waits: Waits = { samples: 0, sameScope: 0, crossScope: 0, crossDetails: [] };
  const state = { running: true };
  const first: { done: () => void } = { done: () => undefined };
  const ready = new Promise<void>((resolve) => {
    first.done = resolve;
  });
  const loop = owner(async (client) => {
    while (state.running) {
      const found = await client.query<{ pid: number; waiter: string; blocker: string }>(
        `select w.pid, w.application_name as waiter, b.application_name as blocker
         from pg_stat_activity w
         cross join lateral unnest(pg_blocking_pids(w.pid)) as bp (pid)
         join pg_stat_activity b on b.pid = bp.pid
         where w.datname = current_database() and w.application_name like 'kwtest:%'
           and b.application_name like 'kwtest:%'`,
      );
      waits.samples += 1;
      first.done();
      for (const wait of found.rows) {
        if (wait.waiter === wait.blocker) {
          waits.sameScope += 1;
          continue;
        }
        waits.crossScope += 1;
        const locks = await client.query(
          `select locktype, relation::regclass::text as relation, page, tuple, transactionid::text as transactionid
           from pg_locks where pid = $1 and not granted`,
          [wait.pid],
        );
        waits.crossDetails.push(
          `${wait.waiter} waited on ${wait.blocker}: ${JSON.stringify(locks.rows)}`,
        );
      }
      await pause(2);
    }
  });
  return {
    ready,
    seen: () => waits,
    stop: async () => {
      state.running = false;
      await loop;
      return waits;
    },
  };
}

describe('positions under concurrent writers on PostgreSQL 18', () => {
  const writersPerTenant = 8;
  const unitsPerWriter = 12;

  test('16 writers in 2 tenants commit gap-free positions per scope; no reader goes backwards; no scope waits on another', async () => {
    const sampler = sampleWaits();
    await sampler.ready;
    const state = { writing: true };
    const scopes: readonly [string, StorageScope][] = [
      ['a', scopeA],
      ['b', scopeB],
    ];
    const writers = Array.from({ length: writersPerTenant * 2 }, async (_, writer) => {
      const [label, scope] = scopes[writer % 2] ?? scopes[0] ?? ['a', scopeA];
      const next = random(writer + 1);
      for (let version = 0; version < unitsPerWriter; version += 1) {
        await pause(Math.floor(next() * 6));
        await tagged(scope, label, async (unit) => {
          await unit.events.append([
            {
              stream: { type: 'app.ticket', id: id(writer + 1) },
              expectedVersion: version,
              partition: null,
              events: [newEvent(writer * 100 + version)],
            },
          ]);
        });
      }
    });
    const readers = scopes.map(async ([, scope]) => {
      let seen = 0n;
      let reads = 0;
      while (state.writing) {
        const page = await adapterOf(scope).unit(
          testNamespace,
          scope,
          async (unit) => ({
            read: await unit.events.readAll(seen === 0n ? null : seen, { limit: 1000 }),
            head: await unit.events.head(),
          }),
          { readOnly: true },
        );
        page.read.events.forEach((event, index) => {
          expect(event.position).toBe(seen + 1n + BigInt(index));
        });
        seen = page.read.events.at(-1)?.position ?? seen;
        expect(page.head ?? 0n).toBeGreaterThanOrEqual(seen);
        reads += 1;
      }
      return reads;
    });
    await Promise.all(writers);
    state.writing = false;
    const reads = await Promise.all(readers);
    const waits = await sampler.stop();

    expect(reads.every((count) => count > 0)).toBe(true);
    expect(waits.samples).toBeGreaterThan(10);
    expect(waits.crossDetails).toEqual([]);
    for (const [, scope] of scopes) {
      const all = await adapter().unit(
        testNamespace,
        scope,
        async (unit) => unit.events.readAll(null, { limit: 1000 }),
        { readOnly: true },
      );
      const total = writersPerTenant * unitsPerWriter;
      expect(all.events.map((event) => event.position)).toEqual(
        Array.from({ length: total }, (_, index) => BigInt(index + 1)),
      );
      const perStream = new Map<string, number[]>();
      for (const event of all.events) {
        perStream.set(event.stream.id, [...(perStream.get(event.stream.id) ?? []), event.version]);
      }
      expect(perStream.size).toBe(writersPerTenant);
      for (const versions of perStream.values()) {
        expect(versions).toEqual(Array.from({ length: unitsPerWriter }, (_, index) => index + 1));
      }
    }
  });

  test('a scope whose counter is held makes only its own writers wait', async () => {
    const sampler = sampleWaits();
    await sampler.ready;
    const held: { release: () => void; locked: () => void } = {
      release: () => undefined,
      locked: () => undefined,
    };
    const releasing = new Promise<void>((resolve) => {
      held.release = resolve;
    });
    const locking = new Promise<void>((resolve) => {
      held.locked = resolve;
    });
    const holder = tagged(scopeA, 'a', async (unit) => {
      await unit.events.append([
        {
          stream: { type: 'app.ticket', id: id(900) },
          expectedVersion: 0,
          partition: null,
          events: [newEvent(1)],
        },
      ]);
      // The tail's statement, run early, takes the counter row lock and keeps it.
      await unit.db.executeQuery(
        CompiledQuery.raw(
          `insert into app.kw_positions (scope_id, next, epoch) values ($1, 1, 1)
           on conflict (scope_id) do update set next = kw_positions.next`,
          [testScopes.tenantA],
        ),
      );
      held.locked();
      await releasing;
    });
    await locking;
    const blockedWriters = [0, 1].map(async (writer) =>
      tagged(scopeA, 'a', async (unit) => {
        await unit.events.append([
          {
            stream: { type: 'app.ticket', id: id(800 + writer) },
            expectedVersion: 0,
            partition: null,
            events: [newEvent(writer)],
          },
        ]);
      }),
    );
    const others = await Promise.all(
      [0, 1, 2, 3].map(async (writer) =>
        tagged(scopeB, 'b', async (unit) => {
          await unit.events.append([
            {
              stream: { type: 'app.ticket', id: id(700 + writer) },
              expectedVersion: 0,
              partition: null,
              events: [newEvent(writer)],
            },
          ]);
        }),
      ),
    );
    expect(others).toHaveLength(4);
    await waitForLockWaiters(2);
    for (let attempt = 0; attempt < 1000 && sampler.seen().sameScope === 0; attempt += 1) {
      await pause(5);
    }
    held.release();
    await Promise.all([holder, ...blockedWriters]);
    const waits = await sampler.stop();
    expect(waits.crossDetails).toEqual([]);
    expect(waits.sameScope).toBeGreaterThan(0);
    const heads = await Promise.all(
      [scopeA, scopeB].map(async (scope) =>
        adapter().unit(testNamespace, scope, async (unit) => unit.events.head(), {
          readOnly: true,
        }),
      ),
    );
    expect(heads).toEqual([3n, 4n]);
  });
});
