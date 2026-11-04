import type { StorageRow } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { account } from '../support/account.ts';
import { failure } from '../support/failure.ts';
import { id } from '../support/id.ts';
import { note } from '../support/note.ts';
import { noteRow } from '../support/note-row.ts';
import { stamp } from '../support/stamp.ts';
import type { StoreFixture } from '../support/store-fixture.ts';
import { storeSuite } from '../support/store-suite.ts';
import { tenantScope } from '../support/tenant-scope.ts';
import { tenantTwo } from '../support/tenant-two.ts';

const memory = storeSuite();

const titles = (rows: readonly StorageRow[]): unknown[] => rows.map((row) => row.title);

async function seedNotes(memory: StoreFixture, rows: readonly StorageRow[]): Promise<void> {
  await memory.run(tenantScope, (unit) => unit.rows.insert(note, rows));
}

describe('insert, find and the archived default', () => {
  test('rows come back without the absent values, newest fields included', async () => {
    await seedNotes(memory, [noteRow(1, { title: 'a', count: 3 })]);
    const page = await memory.read(tenantScope, (unit) => unit.rows.find(note, {}));
    expect(page.rows).toEqual([
      { id: id(1), createdAt: stamp, updatedAt: stamp, version: 1, title: 'a', count: 3 },
    ]);
  });

  test('archived rows are hidden unless asked for', async () => {
    await seedNotes(memory, [
      noteRow(1, { title: 'live' }),
      noteRow(2, { title: 'gone', archivedAt: stamp }),
    ]);
    const find = (includeArchived: boolean): Promise<readonly StorageRow[]> =>
      memory.read(
        tenantScope,
        async (unit) => (await unit.rows.find(note, { includeArchived })).rows,
      );
    expect(titles(await find(false))).toEqual(['live']);
    expect(titles(await find(true))).toEqual(['live', 'gone']);
  });

  test('select keeps the system fields and the named ones', async () => {
    await seedNotes(memory, [noteRow(1, { title: 'a', body: 'b' })]);
    const page = await memory.read(tenantScope, (unit) =>
      unit.rows.find(note, { select: ['body'] }),
    );
    expect(Object.keys(page.rows[0] ?? {}).sort()).toEqual(
      ['body', 'createdAt', 'id', 'updatedAt', 'version'].sort(),
    );
  });

  test('a returned set or byte value is a copy', async () => {
    const tags = new Set(['x']);
    await seedNotes(memory, [noteRow(1, { tags })]);
    tags.add('y');
    const first = await memory.read(tenantScope, (unit) => unit.rows.findOne(note, {}));
    (first?.tags as Set<string> | undefined)?.add('z');
    const second = await memory.read(tenantScope, (unit) => unit.rows.findOne(note, {}));
    expect([...((second?.tags as Set<string> | undefined) ?? [])]).toEqual(['x']);
  });

  test('an unknown column is refused', async () => {
    expect((await failure(seedNotes(memory, [noteRow(1, { nope: 1 })]))).code).toBe(
      'core.malformed_request',
    );
  });

  test('a failed insert leaves none of its rows behind', async () => {
    await failure(seedNotes(memory, [noteRow(1, {}), noteRow(1, {})]));
    expect(await memory.read(tenantScope, (unit) => unit.rows.count(note))).toBe(0);
  });
});

describe('update, purge, exists and count', () => {
  test('an update needs the expected version and replaces the whole row', async () => {
    await seedNotes(memory, [noteRow(1, { title: 'a', body: 'keep?' })]);
    await memory.run(tenantScope, (unit) =>
      unit.rows.update(note, [
        { id: id(1), expectedVersion: 1, values: noteRow(1, { version: 2, title: 'b' }) },
      ]),
    );
    const row = await memory.read(tenantScope, (unit) => unit.rows.findOne(note, {}));
    expect(row).toMatchObject({ title: 'b', version: 2 });
    expect(row?.body).toBeUndefined();
    const stale = await failure(
      memory.run(tenantScope, (unit) =>
        unit.rows.update(note, [
          { id: id(1), expectedVersion: 1, values: noteRow(1, { version: 2 }) },
        ]),
      ),
    );
    expect(stale).toEqual({ kind: 'conflict', code: 'core.version_mismatch' });
    const missing = await failure(
      memory.run(tenantScope, (unit) =>
        unit.rows.update(note, [{ id: id(9), expectedVersion: 1, values: noteRow(9, {}) }]),
      ),
    );
    expect(missing.code).toBe('core.version_mismatch');
  });

  test('purge deletes and counts, exists and count leave archived rows out', async () => {
    await seedNotes(memory, [noteRow(1, {}), noteRow(2, { archivedAt: stamp }), noteRow(3, {})]);
    const [count, exists, purged] = await memory.run(tenantScope, async (unit) => [
      await unit.rows.count(note),
      await unit.rows.exists(note, [id(1), id(2), id(7)]),
      await unit.rows.purge(note, [id(1), id(1), id(8)]),
    ]);
    expect(count).toBe(2);
    expect([...(exists as ReadonlySet<string>)].sort()).toEqual([id(1)]);
    expect(purged).toBe(1);
    expect(await memory.read(tenantScope, (unit) => unit.rows.count(note))).toBe(1);
  });
});

describe('unique fields and indexes', () => {
  const row = (n: number, over: Record<string, unknown>): StorageRow => noteRow(n, over);

  test('a unique field holds among non-archived rows; archiving releases the value', async () => {
    await memory.run(tenantScope, (unit) => unit.rows.insert(account, [row(1, { handle: 'ann' })]));
    expect(
      (
        await failure(
          memory.run(tenantScope, (unit) => unit.rows.insert(account, [row(2, { handle: 'ann' })])),
        )
      ).kind,
    ).toBe('conflict');
    await memory.run(tenantScope, (unit) =>
      unit.rows.update(account, [
        {
          id: id(1),
          expectedVersion: 1,
          values: row(1, { version: 2, handle: 'ann', archivedAt: stamp }),
        },
      ]),
    );
    await memory.run(tenantScope, (unit) => unit.rows.insert(account, [row(2, { handle: 'ann' })]));
    const restore = await failure(
      memory.run(tenantScope, (unit) =>
        unit.rows.update(account, [
          { id: id(1), expectedVersion: 2, values: row(1, { version: 3, handle: 'ann' }) },
        ]),
      ),
    );
    expect(restore.kind).toBe('conflict');
  });

  test("absent values never collide, and one tenant does not see another tenant's values", async () => {
    await memory.run(tenantScope, (unit) => unit.rows.insert(account, [row(1, {}), row(2, {})]));
    await memory.run(tenantScope, (unit) => unit.rows.insert(account, [row(3, { handle: 'x' })]));
    await memory.run(tenantTwo, (unit) => unit.rows.insert(account, [row(4, { handle: 'x' })]));
  });

  test('a partial unique index counts only the rows its condition keeps', async () => {
    await memory.run(tenantScope, (unit) =>
      unit.rows.insert(account, [
        row(1, { slot: 1, kind: 'primary' }),
        row(2, { slot: 1, kind: 'other' }),
      ]),
    );
    const clash = await failure(
      memory.run(tenantScope, (unit) =>
        unit.rows.insert(account, [row(3, { slot: 1, kind: 'primary' })]),
      ),
    );
    expect(clash.kind).toBe('conflict');
  });

  test('a personal unique field is unique by its blind index tag', async () => {
    const tag = new Uint8Array([1, 2, 3]);
    await memory.run(tenantScope, (unit) =>
      unit.rows.insert(account, [row(1, { email: new Uint8Array([9]), emailEq: tag })]),
    );
    const clash = await failure(
      memory.run(tenantScope, (unit) =>
        unit.rows.insert(account, [
          row(2, { email: new Uint8Array([8]), emailEq: new Uint8Array([1, 2, 3]) }),
        ]),
      ),
    );
    expect(clash.kind).toBe('conflict');
  });
});
