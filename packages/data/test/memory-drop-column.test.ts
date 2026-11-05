import type { TableSpec } from '@keelwerk/core';
import { expect, test } from 'vitest';
import { memoryApplyStep } from '../src/memory/memory-apply-step.ts';

const tag = { query: 'eq', kind: 'binary' } as const;
const tagColumn = 'email__eq';
const table: TableSpec = {
  name: 'app__person',
  columns: [
    { name: 'id', field: null, kind: 'uuid', nullable: false, default: null, constraints: {} },
    {
      name: 'email',
      field: 'email',
      kind: 'sealed',
      nullable: true,
      default: null,
      constraints: {},
    },
    {
      name: tagColumn,
      field: 'email',
      kind: 'tags',
      nullable: true,
      default: null,
      constraints: {},
      derived: tag,
    },
  ],
  primaryKey: ['id'],
  indexes: [],
  foreignKeys: [],
  scoped: 'tenant',
};

function draftOf() {
  const row = { id: 'r1', email: new Uint8Array([1]), [tagColumn]: new Uint8Array([2]) };
  return {
    tables: new Map([[table.name, table]]),
    tableOf: new Map([['app.person', table.name]]),
    collections: new Map([[`rows/${table.name}/s1`, new Map<string, unknown>([['r1', row]])]]),
  };
}

test('a dropColumn that names columns drops those columns and their values, and the field stays', () => {
  const draft = draftOf();
  memoryApplyStep(draft, {
    op: 'dropColumn',
    entity: 'app.person',
    field: tagColumn,
    columns: [tagColumn],
  });
  expect(draft.tables.get(table.name)?.columns.map((column) => column.name)).toEqual([
    'id',
    'email',
  ]);
  const rows = draft.collections.get(`rows/${table.name}/s1`);
  expect(Object.keys((rows?.get('r1') ?? {}) as object)).toEqual(['id', 'email']);
});

test('a dropColumn without columns drops the field and the columns it owns', () => {
  const draft = draftOf();
  memoryApplyStep(draft, { op: 'dropColumn', entity: 'app.person', field: 'email' });
  expect(draft.tables.get(table.name)?.columns.map((column) => column.name)).toEqual(['id']);
  const rows = draft.collections.get(`rows/${table.name}/s1`);
  expect(Object.keys((rows?.get('r1') ?? {}) as object)).toEqual(['id']);
});
