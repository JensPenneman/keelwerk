// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { ControlLedger, LedgerRecord } from '@keelwerk/core';
import { encodeLedgerRecord, parseLedgerLine } from '@keelwerk/core/ledger';
import { CompiledQuery, sql } from 'kysely';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * `kw_ledger` of the control root (S-125): the canonical record as jsonb, its time beside it for
 * ordering and retention. Only a deployment-scope unit has this store; the policy of the table
 * admits no other unit. `seq` is an identity column, handed out when a row is inserted, so two
 * appends in flight can commit in the other order: a reader that moves on to the highest seq it saw
 * would skip the record that commits later. An append therefore takes a transaction-level advisory
 * lock on one key of the namespace before it inserts (the lock is released at commit), so the
 * sequence order is the commit order.
 */
export function sqlLedgerStore(ctx: SqlUnitContext): ControlLedger {
  const table = ctx.table('kw_ledger');
  return {
    append: async (record) => {
      ctx.writable();
      await sqlGuard(async () => {
        await ctx.db.executeQuery(
          CompiledQuery.raw('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
            `keelwerk:ledger:${ctx.namespace.root}`,
          ]),
        );
      });
      const row = await sqlGuard(async () =>
        ctx
          .controlDb()
          .insertInto(table)
          .values({
            type: record.type,
            record: sql`${encodeLedgerRecord(record)}::jsonb`,
            recorded_at: record.recordedAt,
          })
          .returning('seq')
          .executeTakeFirstOrThrow(),
      );
      return BigInt(row.seq as string | number | bigint);
    },
    since: async (seq, limit) => {
      const rows = await sqlGuard(async () =>
        ctx
          .controlDb()
          .selectFrom(table)
          .select(['seq', 'record'])
          .where('seq', '>', sql`${seq.toString()}::bigint`)
          .orderBy('seq')
          .limit(limit)
          .execute(),
      );
      const found: { seq: bigint; record: LedgerRecord }[] = [];
      for (const row of rows) {
        const record = parseLedgerLine(JSON.stringify(row.record));
        if (record !== undefined)
          found.push({ seq: BigInt(row.seq as string | number | bigint), record });
      }
      return found;
    },
  };
}
