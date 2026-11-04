import type { MigrationFile } from '@keelwerk/core';
import { expect, test } from 'vitest';
import { column } from './support/column.ts';
import { createNotes } from './support/create-notes.ts';
import { failure } from './support/failure.ts';
import { openMemory } from './support/memory-fixture.ts';
import { note } from './support/note.ts';
import { noteRow } from './support/note-row.ts';
import { noteTable } from './support/note-table.ts';
import { tenantScope } from './support/tenant-scope.ts';

test('provision is idempotent and introspect reads the catalogue back', async () => {
  const memory = openMemory();
  const snapshot = { track: 'app', version: 1, tables: [noteTable], entities: {} };
  await memory.adapter.schema.provision(memory.namespace, [snapshot]);
  await memory.adapter.schema.provision(memory.namespace, [snapshot]);
  const catalogue = await memory.adapter.schema.introspect({ namespace: memory.namespace });
  expect(catalogue.tables).toEqual([noteTable]);
  expect((await failure(memory.adapter.schema.introspect({ url: 'postgres://x' }))).kind).toBe(
    'unsupported',
  );
});

test('apply runs a file, records it with its checksum, and a repeat is a no-op', async () => {
  const memory = openMemory();
  await memory.adapter.schema.apply(memory.namespace, createNotes);
  await memory.adapter.schema.apply(memory.namespace, createNotes);
  const history = await memory.adapter.schema.history(memory.namespace);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ track: 'app', id: '0001-notes', stepsApplied: 1 });
  expect(history[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
  const changed: MigrationFile = {
    ...createNotes,
    steps: [...createNotes.steps, { op: 'rebuild', entity: 'app.note', reason: 'x' }],
  };
  expect((await failure(memory.adapter.schema.apply(memory.namespace, changed))).kind).toBe(
    'conflict',
  );
});

test('DDL is transactional: a file with a failing step changes nothing', async () => {
  const memory = openMemory();
  const broken: MigrationFile = {
    id: '0001-broken',
    track: 'app',
    steps: [
      { op: 'createTable', entity: 'app.note', table: noteTable },
      { op: 'addColumn', entity: 'app.note', field: 'title', column: column('title', 'title') },
    ],
  };
  expect((await failure(memory.adapter.schema.apply(memory.namespace, broken))).kind).toBe(
    'conflict',
  );
  expect((await memory.adapter.schema.introspect({ namespace: memory.namespace })).tables).toEqual(
    [],
  );
  expect(await memory.adapter.schema.history(memory.namespace)).toEqual([]);
  const sql: MigrationFile = {
    id: '0002',
    track: 'app',
    steps: [{ op: 'sql', statements: { postgres: ['select 1'] } }],
  };
  expect((await failure(memory.adapter.schema.apply(memory.namespace, sql))).kind).toBe(
    'unsupported',
  );
});

test('column, index and key steps change the catalogue; dropColumn and copyColumn follow the rows', async () => {
  const memory = openMemory();
  await memory.adapter.schema.apply(memory.namespace, createNotes);
  await memory.run(tenantScope, (unit) =>
    unit.rows.insert(note, [noteRow(1, { title: 'a', body: 'b' })]),
  );
  await memory.adapter.schema.apply(memory.namespace, {
    id: '0002-more',
    track: 'app',
    steps: [
      { op: 'addColumn', entity: 'app.note', field: 'body', column: column('body', 'body') },
      { op: 'copyColumn', entity: 'app.note', from: 'title', to: 'body' },
      { op: 'dropColumn', entity: 'app.note', field: 'title' },
      {
        op: 'createIndex',
        entity: 'app.note',
        index: { name: 'i', columns: ['body'], unique: false, method: 'btree', where: null },
      },
      {
        op: 'addForeignKey',
        entity: 'app.note',
        key: { name: 'fk', columns: ['id'], references: { table: 't', columns: ['id'] } },
      },
    ],
  });
  const [table] = (await memory.adapter.schema.introspect({ namespace: memory.namespace })).tables;
  expect(table?.columns.map((c) => c.name)).toEqual(['id', 'body']);
  expect([table?.indexes.length, table?.foreignKeys.length]).toEqual([1, 1]);
  const row = await memory.read(tenantScope, (unit) =>
    unit.rows.findOne(note, { select: ['title', 'body'] }),
  );
  expect(row).toMatchObject({ body: 'a' });
  expect(row?.title).toBeUndefined();
  await memory.adapter.schema.apply(memory.namespace, {
    id: '0003-drop',
    track: 'app',
    steps: [
      {
        op: 'dropIndex',
        entity: 'app.note',
        index: { name: 'i', columns: [], unique: false, method: 'btree', where: null },
      },
      {
        op: 'dropForeignKey',
        entity: 'app.note',
        key: { name: 'fk', columns: [], references: { table: '', columns: [] } },
      },
      { op: 'dropTable', entity: 'app.note' },
    ],
  });
  expect((await memory.adapter.schema.introspect({ namespace: memory.namespace })).tables).toEqual(
    [],
  );
  expect(await memory.read(tenantScope, (unit) => unit.rows.count(note))).toBe(0);
});

test('render describes the steps and lock serialises its callers', async () => {
  const memory = openMemory();
  expect(memory.adapter.schema.render(memory.namespace, createNotes.steps)).toEqual([
    'create table app__note for app.note',
  ]);
  const order: string[] = [];
  const slow = memory.adapter.schema.lock(memory.namespace, async () => {
    order.push('a');
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push('b');
  });
  const fast = memory.adapter.schema.lock(memory.namespace, async () => {
    order.push('c');
  });
  await Promise.all([slow, fast]);
  expect(order).toEqual(['a', 'b', 'c']);
  await memory.adapter.schema.lock(memory.namespace, () =>
    memory.adapter.schema.apply(memory.namespace, createNotes),
  );
});
