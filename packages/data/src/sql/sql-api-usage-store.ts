// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { ApiUsageCount, ApiUsageStore } from '@keelwerk/core';
import { sql } from 'kysely';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

const chunkSize = 1000;

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function keyOf(row: ApiUsageCount): string {
  return [row.day, row.backendId, row.tenantId, row.apiVersion, row.transport, row.item].join('\0');
}

/**
 * `kw_api_usage` of the control root (S-144, 18.5): shared by PGlite and `pg`. Rows go to the
 * database sorted by key, at most 1000 to a statement, so two concurrent flushes take their row
 * locks in the same order and never deadlock.
 */
export function sqlApiUsageStore(ctx: SqlUnitContext): ApiUsageStore {
  const table = ctx.table('kw_api_usage');
  return {
    add: async (counts) => {
      ctx.writable();
      const sorted = [...counts].sort((a, b) => compare(keyOf(a), keyOf(b)));
      for (let start = 0; start < sorted.length; start += chunkSize) {
        const chunk = sorted.slice(start, start + chunkSize);
        await sqlGuard(async () => {
          await ctx
            .controlDb()
            .insertInto(table)
            .values(
              chunk.map((row) => ({
                day: row.day,
                backend_id: row.backendId,
                tenant_id: row.tenantId,
                api_version: row.apiVersion,
                transport: row.transport,
                item: row.item,
                count: row.count.toString(),
              })),
            )
            .onConflict((conflict) =>
              conflict
                .columns(['day', 'backend_id', 'tenant_id', 'api_version', 'transport', 'item'])
                .doUpdateSet({
                  count: sql`${sql.ref('kw_api_usage.count')} + ${sql.ref('excluded.count')}`,
                }),
            )
            .execute();
        });
      }
    },
    totals: async (query) => {
      const rows = await sqlGuard(async () => {
        let select = ctx
          .controlDb()
          .selectFrom(table)
          .select([
            'backend_id',
            'tenant_id',
            'api_version',
            'transport',
            'item',
            sql<string>`sum(count)::text`.as('total'),
            sql<string>`to_char(min(day), 'YYYY-MM-DD')`.as('first_day'),
            sql<string>`to_char(max(day), 'YYYY-MM-DD')`.as('last_day'),
          ])
          .where(sql<boolean>`day between ${query.since}::date and ${query.until}::date`);
        if (query.backendId !== undefined)
          select = select.where('backend_id', '=', query.backendId);
        if (query.apiVersion !== undefined)
          select = select.where('api_version', '=', query.apiVersion);
        if (query.item !== undefined) select = select.where('item', '=', query.item);
        return select
          .groupBy(['backend_id', 'tenant_id', 'api_version', 'transport', 'item'])
          .orderBy('backend_id')
          .orderBy('tenant_id')
          .orderBy(sql`api_version collate "C"`)
          .orderBy(sql`transport collate "C"`)
          .orderBy(sql`item collate "C"`)
          .limit(query.limit)
          .execute();
      });
      return rows.map((row) => ({
        backendId: String(row.backend_id),
        tenantId: String(row.tenant_id),
        apiVersion: String(row.api_version),
        transport: String(row.transport),
        item: String(row.item),
        count: Number(row.total),
        firstDay: String(row.first_day),
        lastDay: String(row.last_day),
      }));
    },
  };
}
