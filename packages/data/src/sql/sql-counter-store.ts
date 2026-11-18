import type { CounterStore, ScopeCounters } from '@keelwerk/core';
import { canonicalizeJson } from '@keelwerk/core';
import { quoteIdentifier } from './postgres/quote-identifier.ts';
import { runSql } from './run-sql.ts';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/** Whether a counter belongs to a stream (`stream:<name>`, which includes `core.effectAttempt`): marks leave those out (S-119). */
function isStreamCounter(entity: string): boolean {
  return entity.startsWith('stream:');
}

/**
 * The counters of every scope in the unit's namespace (14.7.6): `kw_positions` for the last
 * position and the epoch, `kw_serials` for each serial's last value. A namespace-scope unit reads and
 * raises them through the `maintenance` policies. Serial names are
 * `canonicalizeJson([entity, field, partition])` with the partition as `kw_serials` keeps it.
 */
export function sqlCounterStore(ctx: SqlUnitContext): CounterStore {
  const root = quoteIdentifier(ctx.namespace.root);
  return {
    list: async (page) => {
      const heads = await sqlGuard(() =>
        runSql(ctx.db, {
          sql: `select s.scope_id::text as scope_id, coalesce(p.next - 1, 0)::text as position, coalesce(p.epoch, 1) as epoch from (select scope_id from ${root}.kw_positions union select scope_id from ${root}.kw_serials) s left join ${root}.kw_positions p on p.scope_id = s.scope_id where ($1::text is null or s.scope_id::text > $1::text) and ($2::jsonb is null or s.scope_id::text in (select jsonb_array_elements_text($2::jsonb))) order by s.scope_id::text limit $3::int`,
          parameters: [
            page.after ?? null,
            page.scopeIds === undefined ? null : JSON.stringify([...page.scopeIds]),
            page.limit,
          ],
        }),
      );
      if (heads.length === 0) return [];
      const serialRows = await sqlGuard(() =>
        runSql(ctx.db, {
          sql: `select scope_id::text as scope_id, entity, field, partition, (next - 1)::text as last from ${root}.kw_serials where scope_id::text in (select jsonb_array_elements_text($1::jsonb)) and entity not like 'stream:%'`,
          parameters: [JSON.stringify(heads.map((row) => String(row.scope_id)))],
        }),
      );
      const serials = new Map<string, Record<string, bigint>>();
      for (const row of serialRows) {
        const entity = String(row.entity);
        if (isStreamCounter(entity)) continue;
        const scopeId = String(row.scope_id);
        const held = serials.get(scopeId) ?? {};
        held[canonicalizeJson([entity, String(row.field), String(row.partition)])] = BigInt(
          String(row.last),
        );
        serials.set(scopeId, held);
      }
      return heads.map(
        (row): ScopeCounters => ({
          scopeId: String(row.scope_id),
          position: BigInt(String(row.position)),
          epoch: Number(row.epoch),
          serials: serials.get(String(row.scope_id)) ?? {},
        }),
      );
    },
    raise: async (counters) => {
      ctx.writable();
      await sqlGuard(async () => {
        await runSql(ctx.db, {
          sql: `insert into ${root}.kw_positions as p (scope_id, next, epoch) values ($1::uuid, $2::bigint + 1, $3::int) on conflict (scope_id) do update set next = greatest(p.next, excluded.next), epoch = greatest(p.epoch, excluded.epoch)`,
          parameters: [counters.scopeId, counters.position.toString(), counters.epoch],
        });
        for (const [name, value] of Object.entries(counters.serials)) {
          const [entity, field, partition] = JSON.parse(name) as [string, string, string];
          await runSql(ctx.db, {
            sql: `insert into ${root}.kw_serials as s (scope_id, entity, field, partition, next) values ($1::uuid, $2::text, $3::text, $4::text, $5::bigint + 1) on conflict (scope_id, entity, field, partition) do update set next = greatest(s.next, excluded.next)`,
            parameters: [counters.scopeId, entity, field, partition, value.toString()],
          });
        }
      });
    },
  };
}
