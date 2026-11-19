import { CompiledQuery } from 'kysely';
import { describe, expect, test } from 'vitest';
import { newEvent } from './support/event-fixtures.ts';
import { purgeReceiptOf } from './support/purge-receipt-of.ts';
import { purgeStreamOf } from './support/purge-stream-of.ts';
import { storeHarness } from './support/store-harness.ts';
import { id } from './support/store-rows.ts';
import { testScopes } from './support/test-scopes.ts';

const { scopeA } = testScopes;
const { run, runSql } = storeHarness('purge_receipts');
const stamp = Temporal.Instant.from('2026-01-01T00:00:00Z');
const listed = ['core.commandReceipt'];
const streamOf = (stream: number) => purgeStreamOf(stream, scopeA);

const record = (n: number) => ({
  ...newEvent(n),
  recordedAt: stamp.add({ hours: n }),
  transient: true,
});

const append = (stream: number, events: readonly ReturnType<typeof record>[]) => ({
  stream: { type: 'core.commandReceipt', id: streamOf(stream) },
  expectedVersion: 0,
  partition: null,
  tenancy: 'invocation' as const,
  events,
});

const versionsOf = (stream: number): Promise<readonly number[]> =>
  runSql(scopeA, async (unit) => {
    const found = await unit.db.executeQuery<{ version: number }>(
      CompiledQuery.raw(
        'select stream_version as version from app.kw_events where stream_id = $1::uuid order by stream_version',
        [streamOf(stream)],
      ),
    );
    return found.rows.map((row) => row.version);
  });

const callPurge = (before: Temporal.Instant, maxRows: number, types: readonly string[]) =>
  runSql(scopeA, async (unit) => {
    await unit.db.executeQuery(
      CompiledQuery.raw(
        'select removed, more from app.kw_purge_transient($1::timestamptz, $2::integer, $3::text[])',
        [before.toString(), maxRows, types],
      ),
    );
  });

const refused = (work: Promise<unknown>, code: string) =>
  expect(work).rejects.toMatchObject({ code });

describe('what the function purges of receipt streams on PostgreSQL 18', () => {
  test('a session of the application role cannot purge any other type, whatever it forges or names', async () => {
    // The attack: the history of a state entity, with the newest record of its streams forged by
    // the same role, purged by naming the type. The stored function holds the one type as a
    // literal and refuses every other list, 'infinity' as the instant included.
    await run(scopeA, (unit) =>
      unit.events.append([
        {
          stream: { type: 'app.ticket', id: id(5) },
          expectedVersion: 0,
          partition: null,
          events: [record(1), record(2)],
        },
      ]),
    );
    const forever = {
      toString: () => 'infinity',
    } as unknown as Temporal.Instant;
    for (const types of [['app.ticket'], ['core.commandReceipt', 'app.ticket'], ['']]) {
      await refused(callPurge(forever, 100_000, types), '42501');
    }
    const history = await runSql(scopeA, async (unit) =>
      unit.db.executeQuery<{ n: number }>(
        CompiledQuery.raw(
          `select count(*)::int as n from app.kw_events where stream_type = 'app.ticket'`,
        ),
      ),
    );
    expect(history.rows[0]?.n).toBe(2);
  });

  test('a null instant is refused by the function', async () => {
    await refused(
      runSql(scopeA, async (unit) => {
        await unit.db.executeQuery(
          CompiledQuery.raw(
            `select * from app.kw_purge_transient(null, 10, array['core.commandReceipt'])`,
          ),
        );
      }),
      '22023',
    );
  });

  test('the newest record of a receipt stream goes once its receipt row is gone, and not before', async () => {
    await run(scopeA, async (unit) => {
      for (const n of [1, 2]) await unit.receipts.put(purgeReceiptOf(`c${n}`));
    });
    await run(scopeA, (unit) =>
      unit.events.append([
        append(1, [record(1), record(2)]),
        append(2, [record(11), record(12)]),
        append(3, [record(21), record(22)]),
      ]),
    );
    // Stream 3 has no receipt: both its records go, the others keep their newest.
    expect(
      await run(scopeA, (unit) =>
        unit.events.purgeTransient(stamp.add({ hours: 100 }), 10, listed),
      ),
    ).toEqual({ removed: 4, more: false });
    expect(await versionsOf(1)).toEqual([2]);
    expect(await versionsOf(2)).toEqual([2]);
    expect(await versionsOf(3)).toEqual([]);
    await runSql(scopeA, async (unit) => {
      await unit.db.executeQuery(
        CompiledQuery.raw(`delete from app.core__command_receipt where id = $1::uuid`, [
          streamOf(2),
        ]),
      );
    });
    expect(
      await run(scopeA, (unit) =>
        unit.events.purgeTransient(stamp.add({ hours: 100 }), 10, listed),
      ),
    ).toEqual({ removed: 1, more: false });
    expect(await versionsOf(2)).toEqual([]);
    expect(await versionsOf(1)).toEqual([2]);
  });
});
