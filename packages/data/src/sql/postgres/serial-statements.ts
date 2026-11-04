import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { SqlDb } from '../sql-db.ts';

/** The serial counter a field of a partition draws from (15.1.4). */
export interface SerialCounter {
  /** The table, `<root>.kw_serials`. */
  readonly table: string;
  readonly entity: string;
  readonly field: string;
  /** The canonical JSON of the `per` values. */
  readonly partition: string;
}

/**
 * Takes `count` consecutive values from a counter in one statement: the first insert starts the
 * counter at `count + 1`, every later one adds `count` under the row lock, which the unit holds
 * until it ends. The statement returns the first value taken. `db` carries the scoping plugin,
 * which adds the unit's `scope_id`.
 */
export async function takeSerial(
  db: Kysely<SqlDb>,
  counter: SerialCounter,
  count: number,
): Promise<bigint> {
  const taken = BigInt(count);
  const row = await db
    .insertInto(counter.table)
    .values({
      entity: counter.entity,
      field: counter.field,
      partition: counter.partition,
      next: (taken + 1n).toString(),
    })
    .onConflict((conflict) =>
      conflict
        .columns(['scope_id', 'entity', 'field', 'partition'])
        .doUpdateSet({ next: sql`${sql.ref('kw_serials.next')} + ${taken.toString()}::bigint` }),
    )
    .returning(sql<string>`(next - ${taken.toString()}::bigint)::text`.as('first'))
    .executeTakeFirstOrThrow();
  return BigInt(String(row.first));
}
