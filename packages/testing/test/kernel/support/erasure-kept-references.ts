import { expect } from 'vitest';
import type { DumpQuery } from '../../../src/index.ts';
import { sectionsOf } from './dump-sections.ts';
import { rowsOf, spellingsOf } from './erasure-dump-tools.ts';
import { erasureInventory, erasureKeptReferences } from './erasure-inventory.ts';

/** The invocation tables: entities of the core whose rows an erasure does not erase, held to their inventory lines. */
const invocationTables = ['core__command_receipt', 'core__effect'] as const;

/**
 * After an erasure the subject's id and the ids of the rows it owns (its session, its threads)
 * stand only where the inventory names a kept reference and says why. Tables that are not entities
 * of invocation scope and are not named "reference kept" hold none. An invocation table holds the
 * ids in exactly the columns `erasureKeptReferences` names: a place that is not named fails, and a
 * named place that holds no id any more fails too, so the inventory cannot go stale in either way.
 */
async function expectKeptReferences(input: {
  readonly after: string;
  readonly queries: readonly DumpQuery[];
  readonly entityTables: ReadonlySet<string>;
  readonly ids: readonly string[];
}): Promise<void> {
  const { after, queries, entityTables } = input;
  const owned = input.ids.flatMap(spellingsOf);
  const named = (table: string): boolean => (invocationTables as readonly string[]).includes(table);
  const kept = (table: string): boolean =>
    (entityTables.has(table) && !named(table)) ||
    (erasureInventory[table] ?? '').includes('reference kept');
  const found = [...sectionsOf(after)]
    .filter(([, text]) => owned.some((id) => text.toLowerCase().includes(id)))
    .map(([table]) => table.split('.')[1] ?? table)
    .filter((table) => !(named(table) || kept(table)));
  expect(found).toEqual([]);
  for (const table of invocationTables) {
    const columns = new Set<string>();
    for (const row of await rowsOf(queries, table)) {
      for (const [column, value] of Object.entries(row)) {
        const text = JSON.stringify(value ?? null).toLowerCase();
        if (owned.some((id) => text.includes(id))) columns.add(column);
      }
    }
    const kept_ = erasureKeptReferences[table] ?? {};
    expect(
      [...columns].sort(),
      `${table} holds the subject's id or the id of a row it owns in exactly the columns its inventory line names`,
    ).toEqual(Object.keys(kept_).sort());
    for (const [column, reason] of Object.entries(kept_)) {
      expect(reason.length, `${table}.${column} names why its reference is kept`).toBeGreaterThan(
        20,
      );
    }
  }
}

/** Every table of the databases is named by the inventory or by an entity of the app. */
async function expectEveryTableNamed(
  queries: readonly DumpQuery[],
  entityTables: ReadonlySet<string>,
): Promise<void> {
  const tables: string[] = [];
  for (const query of queries) {
    for (const row of await query(
      `select tablename from pg_tables where schemaname not in ('pg_catalog', 'information_schema', 'pg_toast')`,
    )) {
      tables.push(String(row.tablename));
    }
  }
  expect(
    [...new Set(tables)].filter((name) => !(name in erasureInventory) && !entityTables.has(name)),
  ).toEqual([]);
}

export { expectEveryTableNamed, expectKeptReferences };
