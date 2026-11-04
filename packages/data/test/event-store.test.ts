import type { Position, StorageScope, StreamAppend } from '@keelwerk/core';
import { CompiledQuery } from 'kysely';
import { describe, expect, test } from 'vitest';
import { backendScope } from './support/backend-scope.ts';
import { deploymentScope } from './support/deployment-scope.ts';
import { failure } from './support/failure.ts';
import { id } from './support/id.ts';
import { namespaceScope } from './support/namespace-scope.ts';
import { newEvent } from './support/new-event.ts';
import { ownerRows } from './support/owner-rows.ts';
import { storeSuite } from './support/store-suite.ts';
import { tenantScope } from './support/tenant-scope.ts';
import { tenantTwo } from './support/tenant-two.ts';

const store = storeSuite();

const stream = (n: number, type = 'app.note'): { type: string; id: string } => ({
  type,
  id: id(n),
});

function append(
  n: number,
  events: readonly number[],
  over: Partial<StreamAppend> = {},
): StreamAppend {
  return {
    stream: stream(n),
    expectedVersion: 0,
    partition: null,
    events: events.map((event) => newEvent(event)),
    ...over,
  };
}

const rows = async (sql: string): Promise<readonly Record<string, unknown>[]> =>
  ownerRows(store.adapter, sql);

describe('append, commit tail and positions (15.1.4)', () => {
  test('buffered events get consecutive positions at the commit, versions at append', async () => {
    const results = await store.run(tenantScope, (unit) =>
      unit.events.append([append(1, [1, 2]), append(2, [3])]),
    );
    expect(results).toEqual([
      { eventId: id(2001), version: 1 },
      { eventId: id(2002), version: 2 },
      { eventId: id(2003), version: 1 },
    ]);
    const all = await store.read(tenantScope, (unit) => unit.events.readAll(null, { limit: 10 }));
    expect(
      all.events.map((event) => [event.position, event.stream.id, event.version, event.type]),
    ).toEqual([
      [1n, id(1), 1, 'app.note.created'],
      [2n, id(1), 2, 'app.note.changed'],
      [3n, id(2), 1, 'app.note.changed'],
    ]);
    expect(all.next).toBe(3n);
    expect(await rows('select next::text, epoch from app.kw_positions')).toEqual([
      { next: '4', epoch: 1 },
    ]);
  });

  test('positions continue across units; a rolled-back unit reuses its numbers; committed() lists the unit’s own', async () => {
    await store.run(tenantScope, (unit) => unit.events.append([append(1, [1])]));
    await expect(
      store.run(tenantScope, async (unit) => {
        await unit.events.append([append(2, [1, 2])]);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const events = await store.run(tenantScope, async (unit) => {
      await unit.events.append([append(3, [1])]);
      return unit.events;
    });
    expect(events.committed()).toEqual([2n]);
    expect(await store.read(tenantScope, (unit) => unit.events.head())).toBe(2n);
  });

  test('a reader that saw a position never sees an event at or below it later', async () => {
    const seen: Position[] = [];
    for (let round = 1; round <= 4; round++) {
      await store.run(tenantScope, (unit) => unit.events.append([append(round, [1, 2])]));
      const head = await store.read(tenantScope, (unit) => unit.events.head());
      seen.push(head ?? 0n);
      const after = await store.read(tenantScope, (unit) =>
        unit.events.readAll(head, { limit: 5 }),
      );
      expect(after.events).toEqual([]);
    }
    expect(seen).toEqual([2n, 4n, 6n, 8n]);
  });

  test('each scope counts its own positions; a scope that never appended has no head', async () => {
    await store.run(tenantScope, (unit) => unit.events.append([append(1, [1, 2, 3])]));
    await store.run(tenantTwo, (unit) => unit.events.append([append(1, [1])]));
    await store.run(backendScope, (unit) =>
      unit.events.append([append(1, [1, 2], { stream: stream(1, 'app.setting') })]),
    );
    expect(await store.read(tenantScope, (unit) => unit.events.head())).toBe(3n);
    expect(await store.read(tenantTwo, (unit) => unit.events.head())).toBe(1n);
    expect(await store.read(backendScope, (unit) => unit.events.head())).toBe(2n);
    const own = await store.read(tenantTwo, (unit) => unit.events.readAll(null, { limit: 10 }));
    expect(own.events.map((event) => event.scope)).toEqual([tenantTwo]);
    expect(await store.read(deploymentScope, (unit) => unit.events.head())).toBeNull();
  });

  test('a deployment unit has a log of its own; a namespace unit has none; read-only units cannot append', async () => {
    await store.run(deploymentScope, (unit) =>
      unit.events.append([append(1, [1, 2], { stream: stream(1, 'app.global') })]),
    );
    expect(await store.read(deploymentScope, (unit) => unit.events.head())).toBe(2n);
    const [event] = (
      await store.read(deploymentScope, (unit) => unit.events.readAll(null, { limit: 1 }))
    ).events;
    expect(event?.scope).toEqual({ level: 'deployment' });
    expect(await store.read(tenantScope, (unit) => unit.events.head())).toBeNull();
    expect(
      (await failure(store.run(namespaceScope, (unit) => unit.events.append([append(1, [1])]))))
        .kind,
    ).toBe('internal');
    expect(
      (await failure(store.read(tenantScope, (unit) => unit.events.append([append(1, [1])])))).kind,
    ).toBe('internal');
  });
});

describe('streams of an unknown type', () => {
  test('an append to a stream whose type no entity names is refused, as in memory', async () => {
    const refused = await failure(
      store.run(tenantScope, (unit) =>
        unit.events.append([{ ...append(1, [1]), stream: stream(1, 'app.unknown') }]),
      ),
    );
    expect(refused.kind).toBe('internal');
    expect(await store.read(tenantScope, (unit) => unit.events.head())).toBeNull();
  });
});

describe('expected versions', () => {
  test("a version that is not the stream's is a conflict", async () => {
    await store.run(tenantScope, (unit) => unit.events.append([append(1, [1])]));
    for (const expectedVersion of [0, 2]) {
      expect(
        await failure(
          store.run(tenantScope, (unit) =>
            unit.events.append([append(1, [2], { expectedVersion })]),
          ),
        ),
      ).toEqual({ kind: 'conflict', code: 'core.version_mismatch' });
    }
    await store.run(tenantScope, (unit) =>
      unit.events.append([append(1, [2], { expectedVersion: 1 })]),
    );
  });

  test('a conflict on a later stream buffers nothing of the earlier ones', async () => {
    await store.run(tenantScope, (unit) => unit.events.append([append(2, [1])]));
    await store.run(tenantScope, async (unit) => {
      expect(
        await failure(unit.events.append([append(1, [1]), append(2, [2], { expectedVersion: 0 })])),
      ).toEqual({ kind: 'conflict', code: 'core.version_mismatch' });
      expect(await unit.events.readStream(stream(1))).toEqual([]);
    });
    const all = await store.read(tenantScope, (unit) => unit.events.readAll(null, { limit: 10 }));
    expect(all.events.map((event) => event.stream.id)).toEqual([id(2)]);
  });

  test('two appends to one stream in a batch continue its versions', async () => {
    const results = await store.run(tenantScope, (unit) =>
      unit.events.append([append(1, [1]), append(1, [2], { expectedVersion: 1 })]),
    );
    expect(results.map((result) => result.version)).toEqual([1, 2]);
  });

  test('a version another unit took between the check and the tail loses at the tail', async () => {
    const lost = await failure(
      store.run(tenantScope, async (unit) => {
        await unit.events.append([append(1, [1])]);
        await unit.db.executeQuery(
          CompiledQuery.raw(
            `insert into app.kw_events (scope_id, position, backend_id, stream_type, stream_id, stream_version,
              event_id, name, schema_version, shape_id, data, meta, hlc, recorded_at)
              values ($1, 900, $2, 'app.note', $3, 1, $4, 'created', 1, '\\x00', '{}', '{}', 'h', now())`,
            [
              tenantScope.level === 'tenant' ? tenantScope.tenantId : '',
              tenantScope.level === 'tenant' ? tenantScope.backendId : '',
              id(1),
              id(9000),
            ],
          ),
        );
      }),
    );
    expect(lost).toEqual({ kind: 'conflict', code: 'core.version_mismatch' });
    expect(await rows('select count(*)::int as n from app.kw_events')).toEqual([{ n: 0 }]);
  });
});

describe('the tenancy of a stream', () => {
  test("a stream rides only with a unit of its entity's tenancy", async () => {
    const refused = async (scope: StorageScope, type: string) =>
      failure(
        store.run(scope, (unit) =>
          unit.events.append([append(1, [1], { stream: stream(1, type) })]),
        ),
      );
    const forbidden = { kind: 'forbidden', code: 'core.forbidden' };
    expect(await refused(backendScope, 'app.note')).toEqual(forbidden);
    expect(await refused(deploymentScope, 'app.note')).toEqual(forbidden);
    expect(await refused(tenantScope, 'app.setting')).toEqual(forbidden);
    expect(await refused(deploymentScope, 'app.setting')).toEqual(forbidden);
    expect(await refused(tenantScope, 'app.global')).toEqual(forbidden);
    expect(await refused(backendScope, 'app.global')).toEqual(forbidden);
    for (const [scope, type] of [
      [tenantScope, 'app.note'],
      [backendScope, 'app.setting'],
      [deploymentScope, 'app.global'],
    ] as const) {
      expect(
        await store.run(scope, (unit) =>
          unit.events.append([append(2, [1], { stream: stream(2, type) })]),
        ),
      ).toHaveLength(1);
    }
  });
});

describe('work at the unit end runs before the commit tail (15.1.4)', () => {
  test('beforeCommit work runs in order before the tail takes the counter; a rolled-back savepoint drops its work', async () => {
    const seen: string[] = [];
    await store.run(tenantScope, async (unit) => {
      await unit.events.append([append(1, [1])]);
      unit.beforeCommit(async () => {
        const found = await unit.db.executeQuery(
          CompiledQuery.raw('select count(*)::int as n from app.kw_positions'),
        );
        seen.push(`first:${JSON.stringify(found.rows)}`);
      });
      await unit
        .nested(async (inner) => {
          inner.beforeCommit(async () => {
            seen.push('dropped');
          });
          throw new Error('undo');
        })
        .catch(() => undefined);
      unit.beforeCommit(async () => {
        seen.push('second');
      });
    });
    expect(seen).toEqual(['first:[{"n":0}]', 'second']);
    expect(await rows('select next::int as next from app.kw_positions')).toEqual([{ next: 2 }]);
  });

  test('work registered in a read-only savepoint is dropped, in the scope of the unit and in another', async () => {
    const seen: string[] = [];
    await store.run(tenantScope, async (unit) => {
      await unit.nested(
        async (inner) => {
          inner.beforeCommit(async () => {
            seen.push('same scope');
          });
        },
        { readOnly: true },
      );
      await unit.nested(
        async (inner) => {
          inner.beforeCommit(async () => {
            seen.push('other scope');
          });
        },
        { readOnly: true, as: backendScope },
      );
      await unit
        .nested(
          async (inner) => {
            inner.beforeCommit(async () => {
              seen.push('failed');
            });
            throw new Error('undo');
          },
          { readOnly: true },
        )
        .catch(() => undefined);
      unit.beforeCommit(async () => {
        seen.push('kept');
      });
    });
    expect(seen).toEqual(['kept']);
  });
});
