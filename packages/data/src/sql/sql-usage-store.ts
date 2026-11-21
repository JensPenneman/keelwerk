import type { UsageStore } from '@keelwerk/core';
import { sql } from 'kysely';
import type { SqlCommitBuffer } from './sql-commit-buffer.ts';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';
import { usageGiveBackCharges } from './usage-give-back-charges.ts';
import { usageStoreCharges } from './usage-store-charges.ts';

/** The quota counters of the unit's scope (12.2); they commit with the data they count. */
export function sqlUsageStore(ctx: SqlUnitContext, buffer: SqlCommitBuffer): UsageStore {
  const table = ctx.table('kw_usage');
  return {
    charge: (charges) => {
      const checked = usageStoreCharges(ctx.scope, charges);
      ctx.writable();
      buffer.charge(checked);
    },
    giveBack: (dimension, amount) => {
      const charges = usageGiveBackCharges(ctx.scope, dimension, amount);
      ctx.writable();
      buffer.charge(charges);
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
