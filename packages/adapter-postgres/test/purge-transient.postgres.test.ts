import type { NewEvent, StorageScope, StreamAppend } from '@keelwerk/core';
import { CompiledQuery } from 'kysely';
import { describe, expect, test } from 'vitest';
import { newEvent } from './support/event-fixtures.ts';
import { purgeReceiptOf } from './support/purge-receipt-of.ts';
import { purgeStreamOf } from './support/purge-stream-of.ts';
import { storeHarness } from './support/store-harness.ts';
import { testScopes } from './support/test-scopes.ts';

const { scopeA, scopeB } = testScopes;
const { run, runSql, failure } = storeHarness('purge_transient');
const stamp = Temporal.Instant.from('2026-01-01T00:00:00Z');
const hash = 'cd'.repeat(32);
const listed = ['core.commandReceipt'];

const streamOf = (stream: number, scope: StorageScope = scopeA): string =>
  purgeStreamOf(stream, scope);

/** Stores the receipts of commands `c<n>`: a live receipt's change stream keeps its newest. */
const live = (streams: readonly number[], scope: StorageScope = scopeA) =>
  run(scope, async (unit) => {
    for (const n of streams) await unit.receipts.put(purgeReceiptOf(`c${n}`));
  });

function record(n: number, over: Partial<NewEvent> = {}): NewEvent {
  return { ...newEvent(n), recordedAt: stamp.add({ hours: n }), ...over };
}

function append(
  stream: number,
  events: readonly NewEvent[],
  scope: StorageScope = scopeA,
): StreamAppend {
  return {
    stream: { type: 'core.commandReceipt', id: streamOf(stream, scope) },
    expectedVersion: 0,
    partition: null,
    tenancy: 'invocation',
    events,
  };
}

/** The versions the stream still holds, read as the application role (its own scope only). */
const versionsOf = (stream: number, scope: StorageScope = scopeA): Promise<readonly number[]> =>
  runSql(scope, async (unit) => {
    const found = await unit.db.executeQuery<{ version: number }>(
      CompiledQuery.raw(
        'select stream_version as version from app.kw_events where stream_id = $1::uuid order by stream_version',
        [streamOf(stream, scope)],
      ),
    );
    return found.rows.map((row) => row.version);
  });

/** Calls the function of a root as the application role, in a unit of `scope`, with raw arguments. */
const callPurge = (
  scope: StorageScope,
  root: string,
  before: Temporal.Instant,
  maxRows: number,
  types: readonly string[] | null = listed,
) =>
  runSql(scope, async (unit) => {
    const found = await unit.db.executeQuery<{ removed: number; more: boolean }>(
      CompiledQuery.raw(
        `select removed, more from ${root}.kw_purge_transient($1::timestamptz, $2::integer, $3::text[])`,
        [before.toString(), maxRows, types],
      ),
    );
    return found.rows[0];
  });

const refused = (work: Promise<unknown>, code: string) =>
  expect(work).rejects.toMatchObject({ code });

describe('purgeTransient on PostgreSQL 18', () => {
  test("two purges at once remove each record once and keep each stream's newest", async () => {
    const streams = 20;
    await live(Array.from({ length: streams }, (_, n) => n + 1));
    await run(scopeA, async (unit) => {
      for (let stream = 1; stream <= streams; stream += 1) {
        await unit.events.append([
          append(
            stream,
            [1, 2, 3, 4, 5].map((n) => record(stream * 10 + n, { transient: true })),
          ),
        ]);
      }
    });
    const before = stamp.add({ hours: 720 });
    const purge = (limit: number) =>
      run(scopeA, (unit) => unit.events.purgeTransient(before, limit, listed));
    const counts = await Promise.all([purge(30), purge(30), purge(30), purge(30)]);
    const rest = await purge(1000);
    // Four records of each stream go in all: whoever deleted a row, it went once.
    expect(counts.reduce((sum, batch) => sum + batch.removed, 0) + rest.removed).toBe(streams * 4);
    expect(rest.more).toBe(false);
    for (let stream = 1; stream <= streams; stream += 1)
      expect(await versionsOf(stream)).toEqual([5]);
  });

  test('the application role cannot delete from kw_events, a transient record included', async () => {
    await run(scopeA, (unit) =>
      unit.events.append([
        append(1, [record(1, { transient: true }), record(2, { transient: true })]),
      ]),
    );
    const direct = (where: string, scope: StorageScope = scopeA) =>
      runSql(scope, async (unit) => {
        await unit.db.executeQuery(CompiledQuery.raw(`delete from app.kw_events where ${where}`));
      });
    await refused(direct('transient'), '42501');
    await refused(direct('not transient'), '42501');
    await refused(direct('true', { level: 'namespace', reason: 'purge test' }), '42501');
    await refused(
      runSql(scopeA, async (unit) => {
        await unit.db.executeQuery(CompiledQuery.raw(`update app.kw_events set transient = false`));
      }),
      '42501',
    );
    expect(await versionsOf(1)).toEqual([1, 2]);
  });

  test('the function removes the older transient records and keeps the newest of each stream and every other record', async () => {
    await live([1, 2, 3]);
    await run(scopeA, (unit) =>
      unit.events.append([
        // Stream 1: a transient record, a chained one, a transient with a hash, one with a previous hash, the newest.
        append(1, [
          record(1, { transient: true }),
          record(2, { hash }),
          record(3, { transient: true, hash }),
          record(4, { transient: true, prevHash: hash }),
          record(5, { transient: true }),
        ]),
        // Stream 2: a single transient record is its stream's newest.
        append(2, [record(11, { transient: true })]),
        // Stream 3: recorded after the cut.
        append(3, [
          record(21, { transient: true, recordedAt: stamp.add({ hours: 500 }) }),
          record(22, { transient: true, recordedAt: stamp.add({ hours: 501 }) }),
        ]),
      ]),
    );
    expect(
      await run(scopeA, (unit) =>
        unit.events.purgeTransient(stamp.add({ hours: 100 }), 10, listed),
      ),
    ).toEqual({ removed: 1, more: false });
    expect(await versionsOf(1)).toEqual([2, 3, 4, 5]);
    expect(await versionsOf(2)).toEqual([1]);
    expect(await versionsOf(3)).toEqual([1, 2]);
    expect(
      await run(scopeA, (unit) =>
        unit.events.purgeTransient(stamp.add({ hours: 100 }), 10, listed),
      ),
    ).toEqual({ removed: 0, more: false });
  });

  test('the function leaves the records of another scope', async () => {
    await live([1]);
    await live([1], scopeB);
    await run(scopeA, (unit) =>
      unit.events.append([
        append(1, [record(1, { transient: true }), record(2, { transient: true })]),
      ]),
    );
    await run(scopeB, (unit) =>
      unit.events.append([
        append(1, [record(3, { transient: true }), record(4, { transient: true })], scopeB),
      ]),
    );
    expect(
      await run(scopeB, (unit) =>
        unit.events.purgeTransient(stamp.add({ hours: 100 }), 10, listed),
      ),
    ).toEqual({ removed: 1, more: false });
    expect(await versionsOf(1, scopeA)).toEqual([1, 2]);
    expect(await versionsOf(1, scopeB)).toEqual([2]);
  });

  test('a unit of the namespace scope removes nothing, and a unit that names no scope is refused', async () => {
    await run(scopeA, (unit) =>
      unit.events.append([
        append(1, [record(1, { transient: true }), record(2, { transient: true })]),
      ]),
    );
    const far = stamp.add({ hours: 1000 });
    await refused(callPurge({ level: 'namespace', reason: 'purge test' }, 'app', far, 10), '42501');
    // The control root is the deployment's: a tenant unit names no deployment there.
    await refused(callPurge(scopeA, '"kw__control"', far, 10), '42501');
    expect(await versionsOf(1)).toEqual([1, 2]);
    expect(await run({ level: 'deployment' }, async () => 'ran')).toBe('ran');
    expect(await callPurge({ level: 'deployment' }, '"kw__control"', far, 10)).toEqual({
      removed: 0,
      more: false,
    });
  });

  test('a unit that sets the namespace marker itself still removes nothing', async () => {
    await run(scopeA, (unit) =>
      unit.events.append([
        append(1, [record(1, { transient: true }), record(2, { transient: true })]),
      ]),
    );
    await refused(
      runSql(scopeA, async (unit) => {
        await unit.db.executeQuery(
          CompiledQuery.raw(`select set_config('keelwerk.scope', 'namespace', true)`),
        );
        await unit.db.executeQuery(
          CompiledQuery.raw(
            `select app.kw_purge_transient('2027-01-01T00:00:00Z'::timestamptz, 10, array['core.commandReceipt'])`,
          ),
        );
      }),
      '42501',
    );
    expect(await versionsOf(1)).toEqual([1, 2]);
  });

  test('a limit outside 1 to 100000 is refused by the function, whatever the caller checked', async () => {
    const far = stamp.add({ hours: 1000 });
    for (const limit of [0, -1, 100_001])
      await refused(callPurge(scopeA, 'app', far, limit), '22023');
    expect(await callPurge(scopeA, 'app', far, 1)).toEqual({ removed: 0, more: false });
    expect(await callPurge(scopeA, 'app', far, 100_000)).toEqual({ removed: 0, more: false });
    expect(
      await failure(run(scopeA, (unit) => unit.events.purgeTransient(stamp, 0, listed))),
    ).toEqual({
      kind: 'validation',
      code: 'core.malformed_request',
    });
  });

  test('a null list is refused by the function, an empty one removes nothing', async () => {
    await run(scopeA, (unit) =>
      unit.events.append([
        append(1, [record(1, { transient: true }), record(2, { transient: true })]),
      ]),
    );
    const far = stamp.add({ hours: 1000 });
    await refused(callPurge(scopeA, 'app', far, 10, null), '22023');
    expect(await callPurge(scopeA, 'app', far, 10, [])).toEqual({ removed: 0, more: false });
    expect(await versionsOf(1)).toEqual([1, 2]);
  });

  test('the function is owner-owned and security definer, its search path pinned, and only the application role may execute it', async () => {
    const found = await runSql(scopeA, async (unit) =>
      unit.db.executeQuery<{ definer: boolean; config: string; grantees: string }>(
        CompiledQuery.raw(
          `select p.prosecdef as definer, p.proconfig::text as config,
             (select string_agg(coalesce(g.rolname, 'public'), ',' order by g.rolname) from aclexplode(p.proacl) a
                left join pg_roles g on g.oid = a.grantee where a.privilege_type = 'EXECUTE'
                  and a.grantee <> p.proowner) as grantees
           from pg_proc p where p.proname = 'kw_purge_transient' and p.pronamespace = 'app'::regnamespace`,
        ),
      ),
    );
    expect(found.rows[0]).toEqual({
      definer: true,
      config: '{"search_path=pg_catalog, pg_temp"}',
      grantees: 'kw_app',
    });
    // Only the three-argument form exists: a stale two-argument call finds no function.
    await refused(
      runSql(scopeA, async (unit) => {
        await unit.db.executeQuery(
          CompiledQuery.raw(`select * from app.kw_purge_transient(now(), 10)`),
        );
      }),
      '42883',
    );
  });
});
