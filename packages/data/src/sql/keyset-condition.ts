import type { Expression } from 'kysely';
import { sql } from 'kysely';
import type { CompiledSort, SortKey } from './compile-sort.ts';
import type { EntityTable } from './entity-table.ts';

function equalTo(key: SortKey, table: EntityTable, value: unknown): Expression<boolean> {
  const reference = sql.ref(table.reference(key.column.column));
  return value === null
    ? sql<boolean>`${reference} is null`
    : sql<boolean>`${reference} = ${key.codec.encode(value)}`;
}

/** The rows strictly after (`after`) or before (`before`) the cursor row in the sort order. */
function beyond(
  key: SortKey,
  table: EntityTable,
  value: unknown,
  side: 'after' | 'before',
): Expression<boolean> | undefined {
  const reference = sql.ref(table.reference(key.column.column));
  // Ascending puts absent values last, descending first (14.3.5). "Up" is towards larger values
  // (after in an ascending order, before in a descending one): nothing lies above an absent
  // value and absent values lie above every present one. "Down" mirrors it.
  const up = (key.direction === 'asc') === (side === 'after');
  if (up) {
    if (value === null) return undefined;
    return sql<boolean>`(${reference} > ${key.codec.encode(value)} or ${reference} is null)`;
  }
  if (value === null) return sql<boolean>`${reference} is not null`;
  return sql<boolean>`${reference} < ${key.codec.encode(value)}`;
}

export function keysetCondition(
  sort: CompiledSort,
  table: EntityTable,
  values: readonly unknown[],
  id: string,
  side: 'after' | 'before',
): Expression<boolean> {
  const all = [...values, id];
  const alternatives: Expression<boolean>[] = [];
  sort.keys.forEach((key, index) => {
    const here = beyond(key, table, all[index], side);
    if (here === undefined) return;
    const ties = sort.keys.slice(0, index).map((earlier, at) => equalTo(earlier, table, all[at]));
    alternatives.push(
      ties.length === 0 ? here : sql<boolean>`(${sql.join([...ties, here], sql.raw(' and '))})`,
    );
  });
  return alternatives.length === 0
    ? sql<boolean>`false`
    : sql<boolean>`(${sql.join(alternatives, sql.raw(' or '))})`;
}
