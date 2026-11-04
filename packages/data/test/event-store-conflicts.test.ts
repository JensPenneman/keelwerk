import type { StreamAppend } from '@keelwerk/core';
import { isKeelwerkError } from '@keelwerk/core';
import { CompiledQuery } from 'kysely';
import { describe, expect, test } from 'vitest';
import type { SqlUnit } from '../src/sql/sql-unit.ts';
import { id } from './support/id.ts';
import { newEvent } from './support/new-event.ts';
import { ownerRows } from './support/owner-rows.ts';
import { storeSuite } from './support/store-suite.ts';
import { tenantScope } from './support/tenant-scope.ts';

const store = storeSuite();

const stream = (n: number): { type: string; id: string } => ({ type: 'app.note', id: id(n) });

function append(n: number, events: readonly number[]): StreamAppend {
  return {
    stream: stream(n),
    expectedVersion: 0,
    partition: null,
    events: events.map((event) => newEvent(event)),
  };
}

const rows = async (sql: string): Promise<readonly Record<string, unknown>[]> =>
  ownerRows(store.adapter, sql);

/** Another unit's row, committed first as far as the tail can tell: one version of one stream. */
async function take(unit: SqlUnit, n: number, version: number, eventId: number): Promise<void> {
  await unit.db.executeQuery(
    CompiledQuery.raw(
      `insert into app.kw_events (scope_id, position, backend_id, stream_type, stream_id, stream_version,
        event_id, name, schema_version, shape_id, data, meta, hlc, recorded_at)
        values ($1, $5, $2, 'app.note', $3, $6, $4, 'created', 1, '\\x00', '{}', '{}', 'h', now())`,
      [
        tenantScope.level === 'tenant' ? tenantScope.tenantId : '',
        tenantScope.level === 'tenant' ? tenantScope.backendId : '',
        id(n),
        id(eventId),
        String(900 + eventId),
        String(version),
      ],
    ),
  );
}

async function conflictDetails(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    if (isKeelwerkError(error)) return error.details;
    throw error;
  }
  throw new Error('expected a KeelwerkError');
}

describe('the streams a commit tail names as lost', () => {
  test('one lost stream is named alone, the other stream of the unit is not', async () => {
    const details = await conflictDetails(
      store.run(tenantScope, async (unit) => {
        await unit.events.append([append(1, [1, 2]), append(2, [3])]);
        await take(unit, 1, 2, 9001);
      }),
    );
    expect(details).toEqual({ stream: stream(1) });
    expect(await rows('select count(*)::int as n from app.kw_events')).toEqual([{ n: 0 }]);
    expect(await rows('select next::text from app.kw_positions')).toEqual([]);
  });

  test('every lost stream is named', async () => {
    const details = await conflictDetails(
      store.run(tenantScope, async (unit) => {
        await unit.events.append([append(1, [1, 2]), append(2, [3])]);
        await take(unit, 1, 2, 9001);
        await take(unit, 2, 1, 9002);
      }),
    );
    expect(details).toEqual({ streams: [stream(1), stream(2)] });
    expect(await rows('select count(*)::int as n from app.kw_events')).toEqual([{ n: 0 }]);
    expect(await rows('select next::text from app.kw_positions')).toEqual([]);
  });

  test('a stream id in capitals or without hyphens is written, not reported as a conflict', async () => {
    const upper = 'ABCDEF00-AAAA-7AAA-8AAA-ABCDEFABCDEF';
    const bare = 'abcdef01aaaa7aaa8aaaabcdefabcdef';
    await store.run(tenantScope, (unit) =>
      unit.events.append([
        { ...append(1, [1]), stream: { type: 'app.note', id: upper } },
        { ...append(2, [2]), stream: { type: 'app.note', id: bare } },
      ]),
    );
    expect(
      await rows('select stream_id::text as "streamId" from app.kw_events order by position'),
    ).toEqual([
      { streamId: upper.toLowerCase() },
      { streamId: 'abcdef01-aaaa-7aaa-8aaa-abcdefabcdef' },
    ]);
  });
});

describe('work at the unit end', () => {
  test('work that swallows a statement error fails the unit instead of letting commit roll back silently', async () => {
    let ran = false;
    await expect(
      store.run(tenantScope, async (unit) => {
        unit.beforeCommit(async () => {
          ran = true;
          await unit.db.executeQuery(CompiledQuery.raw('select 1 / 0')).catch(() => undefined);
        });
      }),
    ).rejects.toThrow(/transaction is aborted/);
    expect(ran).toBe(true);
  });

  test('work registered by running work runs too, before the commit tail', async () => {
    const seen: string[] = [];
    await store.run(tenantScope, async (unit) => {
      await unit.events.append([append(1, [1])]);
      unit.beforeCommit(async () => {
        seen.push('first');
        unit.beforeCommit(async () => {
          seen.push('second');
          unit.beforeCommit(async () => {
            const found = await unit.db.executeQuery(
              CompiledQuery.raw('select count(*)::int as n from app.kw_positions'),
            );
            seen.push(`third:${JSON.stringify(found.rows)}`);
          });
        });
      });
    });
    expect(seen).toEqual(['first', 'second', 'third:[{"n":0}]']);
    expect(await rows('select next::int as next from app.kw_positions')).toEqual([{ next: 2 }]);
  });
});
