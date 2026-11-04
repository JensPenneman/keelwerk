// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { StorageScope } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { account } from '../support/account.ts';
import { backendScope } from '../support/backend-scope.ts';
import { failure } from '../support/failure.ts';
import { id } from '../support/id.ts';
import { note } from '../support/note.ts';
import { noteRow } from '../support/note-row.ts';
import { setting } from '../support/setting.ts';
import { storeSuite } from '../support/store-suite.ts';
import { tenantScope } from '../support/tenant-scope.ts';
import { tenantTwo } from '../support/tenant-two.ts';

const store = storeSuite();

describe('savepoints', () => {
  test('a failed savepoint takes its rows back and the unit goes on', async () => {
    const titles = await store.run(tenantScope, async (unit) => {
      await unit.rows.insert(note, [noteRow(1, { title: 'kept' })]);
      await unit
        .nested(async (inner) => {
          await inner.rows.insert(note, [noteRow(2, { title: 'undone' })]);
          throw new Error('undo');
        })
        .catch(() => undefined);
      await unit.nested((inner) => inner.rows.insert(note, [noteRow(3, { title: 'second' })]));
      return (
        await unit.rows.find(note, { sort: [{ field: 'title', direction: 'asc' }] })
      ).rows.map((row) => row.title);
    });
    expect(titles).toEqual(['kept', 'second']);
  });

  test('a unique violation inside a savepoint is a conflict and leaves the unit usable', async () => {
    const outcome = await store.run(tenantScope, async (unit) => {
      await unit.rows.insert(account, [noteRow(1, { handle: 'ann' })]);
      const clash = await failure(
        unit.nested((inner) => inner.rows.insert(account, [noteRow(2, { handle: 'ann' })])),
      );
      return { clash, count: await unit.rows.count(account) };
    });
    expect(outcome).toEqual({ clash: { kind: 'conflict', code: 'core.conflict' }, count: 1 });
  });

  test('afterCommit callbacks of a rolled-back savepoint are dropped, the others run after the commit', async () => {
    const ran: string[] = [];
    await store.run(tenantScope, async (unit) => {
      unit.afterCommit(() => ran.push('outer'));
      await unit
        .nested(async (inner) => {
          inner.afterCommit(() => ran.push('inner'));
          throw new Error('undo');
        })
        .catch(() => undefined);
      expect(ran).toEqual([]);
    });
    expect(ran).toEqual(['outer']);
  });
});

describe('cross-scope savepoints', () => {
  test('a tenant unit reads backend rows in a read-only savepoint and gets its own scope back', async () => {
    await store.run(backendScope, (unit) =>
      unit.rows.insert(setting, [noteRow(1, { name: 'theme' })]),
    );
    const seen = await store.run(tenantScope, async (unit) => {
      await unit.rows.insert(note, [noteRow(1, { title: 'mine' })]);
      const direct = await failure(unit.rows.find(setting, {}));
      const settings = await unit.nested(
        async (inner) => (await inner.rows.find(setting, {})).rows.map((row) => row.name),
        { as: backendScope, readOnly: true },
      );
      const afterwards = await unit.rows.find(note, {});
      await unit.rows.insert(note, [noteRow(2, { title: 'still writable' })]);
      return { direct, settings, titles: afterwards.rows.map((row) => row.title) };
    });
    expect(seen).toEqual({
      direct: { kind: 'forbidden', code: 'core.forbidden' },
      settings: ['theme'],
      titles: ['mine'],
    });
    expect(await store.read(tenantScope, (unit) => unit.rows.count(note))).toBe(2);
  });

  test('the savepoint refuses writes, and the unit can write again after it', async () => {
    await store.run(tenantScope, async (unit) => {
      const refused = await failure(
        unit.nested((inner) => inner.rows.insert(note, [noteRow(1, { title: 'no' })]), {
          readOnly: true,
        }),
      );
      expect(refused.kind).toBe('internal');
      await unit.rows.insert(note, [noteRow(2, { title: 'yes' })]);
    });
    expect(await store.read(tenantScope, (unit) => unit.rows.count(note))).toBe(1);
  });

  test('the database refuses a write that bypasses the stores inside a read-only savepoint', async () => {
    await store.run(tenantScope, async (unit) => {
      await expect(
        unit.nested(
          async (inner) => {
            await inner.db
              .insertInto('app.kw_usage')
              .values({
                scope_id: tenantScope.level === 'tenant' ? tenantScope.tenantId : '',
                dimension: 'x',
                value: 1,
              })
              .execute();
          },
          { readOnly: true },
        ),
      ).rejects.toMatchObject({ code: '25006' });
    });
  });

  test('a unit spans one scope: a read-write savepoint in another scope is refused', async () => {
    const refused = await store.run(tenantScope, async (unit) =>
      failure(
        unit.nested((inner) => inner.rows.insert(setting, [noteRow(1, { name: 'x' })]), {
          as: backendScope,
        }),
      ),
    );
    expect(refused.kind).toBe('forbidden');
    expect(await store.read(backendScope, (unit) => unit.rows.count(setting))).toBe(0);
  });

  test('a read-only savepoint reads only the backend from a tenant unit, never another tenant', async () => {
    const other = await store.run(tenantScope, async (unit) =>
      failure(unit.nested(async () => undefined, { as: tenantTwo, readOnly: true })),
    );
    expect(other.kind).toBe('forbidden');
    const deployment = await store.run(tenantScope, async (unit) =>
      failure(unit.nested(async () => undefined, { as: { level: 'deployment' }, readOnly: true })),
    );
    expect(deployment.kind).toBe('forbidden');
    const fromBackend = await store.run(backendScope, async (unit) =>
      failure(unit.nested(async () => undefined, { as: tenantScope, readOnly: true })),
    );
    expect(fromBackend.kind).toBe('forbidden');
  });

  test('a savepoint cannot widen a read-only unit, and a namespace savepoint is refused', async () => {
    const widened = await store.read(tenantScope, async (unit) =>
      failure(
        unit.nested((inner) => inner.rows.insert(note, [noteRow(1, {})]), { readOnly: false }),
      ),
    );
    expect(widened.kind).toBe('internal');
    const other: StorageScope = { level: 'namespace', reason: 'test' };
    const refused = await store.run(tenantScope, async (unit) =>
      failure(unit.nested(async () => undefined, { as: other })),
    );
    expect(refused.kind).toBe('forbidden');
  });
});

describe('isolation', () => {
  test('row-level security alone confines a statement that skips the scoping plugin', async () => {
    await store.run(tenantScope, (unit) => unit.rows.insert(note, [noteRow(1, { title: 'a' })]));
    await store.run(tenantTwo, (unit) => unit.rows.insert(note, [noteRow(2, { title: 'b' })]));
    const raw = await store.read(tenantScope, async (unit) => {
      const result = await unit.db.selectFrom('app.app__note').select('title').execute();
      return result.map((row) => row.title);
    });
    expect(raw).toEqual(['a']);
  });

  test('another scope cannot update, purge or lock a row it does not own', async () => {
    await store.run(tenantScope, (unit) => unit.rows.insert(note, [noteRow(1, { title: 'a' })]));
    const stale = await failure(
      store.run(tenantTwo, (unit) =>
        unit.rows.update(note, [
          { id: id(1), expectedVersion: 1, values: noteRow(1, { version: 2, title: 'x' }) },
        ]),
      ),
    );
    expect(stale.code).toBe('core.version_mismatch');
    expect(await store.run(tenantTwo, (unit) => unit.rows.purge(note, [id(1)]))).toBe(0);
    const locked = await store.run(
      tenantTwo,
      async (unit) => (await unit.rows.lock?.(note, {}, { mode: 'update' })) ?? [],
    );
    expect(locked).toEqual([]);
    expect(await store.read(tenantScope, (unit) => unit.rows.count(note))).toBe(1);
  });
});

describe('locks and counts before a row', () => {
  test('lock returns the rows in share and update mode, with skip locked and no wait', async () => {
    await store.run(tenantScope, (unit) =>
      unit.rows.insert(note, [noteRow(1, { title: 'a' }), noteRow(2, { title: 'b' })]),
    );
    const modes = await store.run(tenantScope, async (unit) => [
      (await unit.rows.lock?.(note, {}, { mode: 'update' }))?.length,
      (await unit.rows.lock?.(note, {}, { mode: 'share', skipLocked: true }))?.length,
      (
        await unit.rows.lock?.(
          note,
          { where: { op: 'eq', field: 'title', value: 'a' } },
          { mode: 'update', noWait: true },
        )
      )?.length,
    ]);
    expect(modes).toEqual([2, 2, 1]);
  });

  test('countBefore counts the rows ahead of one in the query order', async () => {
    await store.run(tenantScope, (unit) =>
      unit.rows.insert(note, [
        noteRow(1, { title: 'c' }),
        noteRow(2, { title: 'a' }),
        noteRow(3, { title: 'b' }),
        noteRow(4, { title: 'd', archivedAt: noteRow(0, {}).createdAt }),
      ]),
    );
    const sort = [{ field: 'title', direction: 'asc' as const }];
    const before = await store.read(tenantScope, async (unit) => [
      await unit.rows.countBefore?.(note, { sort }, id(2)),
      await unit.rows.countBefore?.(note, { sort }, id(1)),
      await unit.rows.countBefore?.(note, { sort: [{ field: 'title', direction: 'desc' }] }, id(1)),
    ]);
    expect(before).toEqual([0, 2, 0]);
    expect(
      (
        await failure(
          store.read(tenantScope, async (unit) => unit.rows.countBefore?.(note, {}, id(9))),
        )
      ).kind,
    ).toBe('not_found');
  });
});
