import type { Condition, StorageRow } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { id } from '../support/id.ts';
import { item } from '../support/item.ts';
import { itemLabel } from '../support/item-label.ts';
import { label } from '../support/label.ts';
import { openMemory } from '../support/memory-fixture.ts';
import { noteRow } from '../support/note-row.ts';
import { stamp } from '../support/stamp.ts';
import { storeSuite } from '../support/store-suite.ts';
import { tenantScope } from '../support/tenant-scope.ts';
import { tenantTwo } from '../support/tenant-two.ts';

const sql = storeSuite();

const labels: readonly StorageRow[] = [
  noteRow(101, { name: 'red' }),
  noteRow(102, { name: 'blue' }),
  noteRow(103, { name: 'gone', archivedAt: stamp }),
];
const items: readonly StorageRow[] = [
  noteRow(1, { name: 'both' }),
  noteRow(2, { name: 'red only' }),
  noteRow(3, { name: 'none' }),
  noteRow(4, { name: 'archived label only' }),
  noteRow(5, { name: 'archived join only' }),
  noteRow(6, { name: 'blue twice' }),
];
const links: readonly [number, number, number, boolean][] = [
  [201, 1, 101, false],
  [202, 1, 102, false],
  [203, 2, 101, false],
  [204, 4, 103, false],
  [205, 5, 101, true],
  [206, 6, 102, false],
  [207, 6, 102, false],
];
const joinRows: readonly StorageRow[] = links.map(([n, itemN, labelN, archived]) =>
  noteRow(n, {
    itemId: id(itemN),
    labelId: id(labelN),
    ...(archived ? { archivedAt: stamp } : {}),
  }),
);

const red: Condition = { op: 'eq', field: 'name', value: 'red' };
const blue: Condition = { op: 'eq', field: 'name', value: 'blue' };
const conditions: Record<string, Condition> = {
  'some red': { op: 'some', relation: 'labels', where: red },
  'none red': { op: 'none', relation: 'labels', where: red },
  'every red': { op: 'every', relation: 'labels', where: red },
  'every blue or red': {
    op: 'every',
    relation: 'labels',
    where: { op: 'or', conditions: [red, blue] },
  },
  'some of nothing': { op: 'some', relation: 'labels', where: { op: 'never' } },
  'none of nothing': { op: 'none', relation: 'labels', where: { op: 'never' } },
  'not some blue': { op: 'not', condition: { op: 'some', relation: 'labels', where: blue } },
  'some blue and some red': {
    op: 'and',
    conditions: [
      { op: 'some', relation: 'labels', where: blue },
      { op: 'some', relation: 'labels', where: red },
    ],
  },
};

describe('relations through a join entity (oracle: the in-memory evaluator)', () => {
  test.each(Object.entries(conditions))('%s', async (_name, condition) => {
    const memory = openMemory([item, label, itemLabel]);
    const everyId = items.map((row) => String(row.id));
    await memory.run(tenantScope, async (unit) => {
      await unit.rows.insert(label, labels);
      await unit.rows.insert(item, items);
      await unit.rows.insert(itemLabel, joinRows);
    });
    await sql.run(tenantScope, async (unit) => {
      await unit.rows.insert(label, labels);
      await unit.rows.insert(item, items);
      await unit.rows.insert(itemLabel, joinRows);
    });
    const expected = await memory.run(tenantScope, (unit) =>
      unit.rows.matching(item, everyId, condition),
    );
    const actual = await sql.run(tenantScope, (unit) =>
      unit.rows.matching(item, everyId, condition),
    );
    expect([...actual].sort()).toEqual([...expected].sort());
    const found = await sql.read(tenantScope, async (unit) =>
      (await unit.rows.find(item, { where: condition })).rows.map((row) => String(row.id)),
    );
    expect(found.sort()).toEqual(
      [...expected].filter((matched) => items.some((row) => row.id === matched)).sort(),
    );
  });

  test('the compiled quantifiers name the expected items', async () => {
    await sql.run(tenantScope, async (unit) => {
      await unit.rows.insert(label, labels);
      await unit.rows.insert(item, items);
      await unit.rows.insert(itemLabel, joinRows);
    });
    const ids = async (name: string): Promise<number[]> =>
      sql.read(tenantScope, async (unit) =>
        (await unit.rows.find(item, { where: conditions[name] as Condition })).rows
          .map((row) => Number(String(row.id).slice(-3)))
          .sort((a, b) => a - b),
      );
    expect(await ids('some red')).toEqual([1, 2]);
    expect(await ids('none red')).toEqual([3, 4, 5, 6]);
    expect(await ids('every red')).toEqual([2, 3, 4, 5]);
  });

  test('another tenant sees none of the joins', async () => {
    await sql.run(tenantScope, async (unit) => {
      await unit.rows.insert(label, labels);
      await unit.rows.insert(item, items);
      await unit.rows.insert(itemLabel, joinRows);
    });
    await sql.run(tenantTwo, (unit) => unit.rows.insert(item, [noteRow(1, { name: 'theirs' })]));
    const some = await sql.read(
      tenantTwo,
      async (unit) =>
        (await unit.rows.find(item, { where: conditions['some red'] as Condition })).rows.length,
    );
    expect(some).toBe(0);
  });
});
