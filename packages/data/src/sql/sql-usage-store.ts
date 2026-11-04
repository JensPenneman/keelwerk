import type { UsageStore } from '@keelwerk/core';
import { sql } from 'kysely';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/** The quota counters of the unit's scope (12.2); they commit with the data they count. */
export function sqlUsageStore(ctx: SqlUnitContext): UsageStore {
  const table = ctx.table('kw_usage');
  return {
    add: async (dimension, delta) => {
      ctx.writable();
      const row = await sqlGuard(async () =>
        ctx
          .scopedDb()
          .insertInto(table)
          .values({ dimension, value: delta.toString() })
          .onConflict((conflict) =>
            conflict.columns(['scope_id', 'dimension']).doUpdateSet({
              value: sql`${sql.ref('kw_usage.value')} + ${delta.toString()}::bigint`,
            }),
          )
          .returning(sql<string>`value::text`.as('value'))
          .executeTakeFirstOrThrow(),
      );
      return BigInt(String(row.value));
    },
    get: async (dimension) => {
      const row = await sqlGuard(async () =>
        ctx
          .scopedDb()
          .selectFrom(table)
          .select(sql<string>`value::text`.as('value'))
          .where('dimension', '=', dimension)
          .executeTakeFirst(),
      );
      return row === undefined ? 0n : BigInt(String(row.value));
    },
  };
}
