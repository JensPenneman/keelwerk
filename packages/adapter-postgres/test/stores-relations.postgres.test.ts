// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { Condition, StorageRow } from '@keelwerk/core';
import { memoryAdapter } from '@keelwerk/data';
import { describe, expect, test } from 'vitest';
import { item, itemLabel, label } from './support/store-entities.ts';
import { storeHarness } from './support/store-harness.ts';
import { id, known, row, stamp } from './support/store-rows.ts';
import { testEnvironment } from './support/test-environment.ts';
import { testNamespace } from './support/test-namespace.ts';
import { testScopes } from './support/test-scopes.ts';

const { scopeA } = testScopes;
const { run, clock } = storeHarness('stores_relations');

describe('relations through a join entity (oracle: the in-memory evaluator)', () => {
  const red: Condition = { op: 'eq', field: 'name', value: 'red' };
  const blue: Condition = { op: 'eq', field: 'name', value: 'blue' };
  const conditions: readonly Condition[] = [
    { op: 'some', relation: 'labels', where: red },
    { op: 'none', relation: 'labels', where: red },
    { op: 'every', relation: 'labels', where: red },
    { op: 'every', relation: 'labels', where: { op: 'or', conditions: [red, blue] } },
    { op: 'not', condition: { op: 'some', relation: 'labels', where: blue } },
  ];
  const seed = async (insert: (entity: typeof item, rows: StorageRow[]) => Promise<void>) => {
    await insert(label, [
      row(101, { name: 'red' }),
      row(102, { name: 'blue' }),
      row(103, { name: 'gone', archivedAt: stamp }),
    ]);
    await insert(
      item,
      [1, 2, 3, 4, 5].map((n) => row(n, { name: `i${n}` })),
    );
    await insert(itemLabel, [
      row(201, { itemId: id(1), labelId: id(101) }),
      row(202, { itemId: id(1), labelId: id(102) }),
      row(203, { itemId: id(2), labelId: id(101) }),
      row(204, { itemId: id(4), labelId: id(103) }),
      row(205, { itemId: id(5), labelId: id(101), archivedAt: stamp }),
    ]);
  };

  test.each(conditions.map((condition, index) => [index, condition] as const))(
    'condition %i',
    async (_index, condition) => {
      const memory = memoryAdapter({ clock, entities: (ref) => known.get(ref) }).create(
        { id: 'memory', strategy: 'shared-tables' },
        testEnvironment(),
      );
      await memory.connect();
      const everyId = [1, 2, 3, 4, 5].map(id);
      await memory.unit(testNamespace, scopeA, async (u) =>
        seed(async (entity, rows) => u.rows.insert(entity, rows)),
      );
      await run(scopeA, (u) => seed(async (entity, rows) => u.rows.insert(entity, rows)));
      const expected = await memory.unit(testNamespace, scopeA, (u) =>
        u.rows.matching(item, everyId, condition),
      );
      const actual = await run<ReadonlySet<string>>(scopeA, (u) =>
        u.rows.matching(item, everyId, condition),
      );
      expect([...actual].sort()).toEqual([...expected].sort());
    },
  );
});
