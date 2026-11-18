// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { ControlLedger, LedgerRecord, UnfinishedErasure } from '@keelwerk/core';
import { encodeLedgerRecord, parseLedgerLine } from '@keelwerk/core/ledger';
import { CompiledQuery, sql } from 'kysely';
import { malformedQuery } from './malformed-query.ts';
import { ledgerFindStatement } from './postgres/ledger-find-statement.ts';
import { ledgerUnfinishedStatement } from './postgres/ledger-unfinished-statement.ts';
import { quoteIdentifier } from './postgres/quote-identifier.ts';
import { runSql } from './run-sql.ts';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/** Lookups one `find` takes, and entries it answers. */
const maxLookups = 500;

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
  const recordOf = (value: unknown): LedgerRecord | undefined =>
    parseLedgerLine(JSON.stringify(value));
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
    find: async (lookups, page) => {
      if (lookups.length > maxLookups) {
        throw malformedQuery(`a ledger lookup takes at most ${maxLookups} entries`);
      }
      const rows = await sqlGuard(() =>
        runSql(
          ctx.db,
          ledgerFindStatement(ctx.namespace.root, lookups, {
            after: page?.after ?? 0n,
            limit: Math.min(page?.limit ?? maxLookups, maxLookups),
          }),
        ),
      );
      const found: { seq: bigint; record: LedgerRecord }[] = [];
      for (const row of rows) {
        const record = recordOf(row.record);
        if (record !== undefined) found.push({ seq: BigInt(String(row.seq)), record });
      }
      return found;
    },
    unfinished: async (query) => {
      // The head first: a record appended between the two reads is then read by the caller's poll.
      const [headRow] = await sqlGuard(() =>
        runSql(ctx.db, {
          sql: `select coalesce(max(seq), 0)::text as head from ${quoteIdentifier(ctx.namespace.root)}.kw_ledger`,
          parameters: [],
        }),
      );
      const rows = await sqlGuard(() =>
        runSql(
          ctx.db,
          ledgerUnfinishedStatement(ctx.namespace.root, {
            ...query,
            epochs: Object.fromEntries(query.epochs),
          }),
        ),
      );
      const erasures: UnfinishedErasure[] = [];
      for (const row of rows) {
        const record = recordOf(row.record);
        if (record?.type === 'erasure') {
          erasures.push({ seq: BigInt(String(row.seq)), record, rerun: row.rerun === true });
        }
      }
      return { erasures, head: BigInt(String(headRow?.head ?? '0')) };
    },
  };
}
