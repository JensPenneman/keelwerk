import type { ScopeMark, ScopeMarks } from '@keelwerk/core';
import { decodeInstant } from './decode-instant.ts';
import { encodeInstant } from './encode-instant.ts';
import { quoteIdentifier } from './postgres/quote-identifier.ts';
import { serialMarksMerge } from './postgres/serial-marks-merge.ts';
import type { SqlRow } from './run-sql.ts';
import { runSql } from './run-sql.ts';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

const columns =
  'scope_id::text as scope_id, namespace_id, position::text as position, serials::text as serials, epoch, updated_at';

function serialsText(serials: ScopeMark['serials']): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(serials).map(([name, value]) => [name, value.toString()])),
  );
}

function markOf(row: SqlRow): ScopeMark {
  const stored = JSON.parse(String(row.serials)) as Record<string, string>;
  return {
    scopeId: String(row.scope_id),
    namespaceId: String(row.namespace_id),
    position: BigInt(String(row.position)),
    serials: Object.fromEntries(
      Object.entries(stored).map(([name, value]) => [name, BigInt(value)]),
    ),
    epoch: Number(row.epoch),
    updatedAt: decodeInstant(row.updated_at),
  };
}

/**
 * `kw_scope_marks` of the control root (14.7.6, S-119): shared by PGlite and `pg`; only a
 * deployment-scope unit has this store. A mark only rises: `raise` keeps the greater position and
 * serial values and a stored epoch, and `bump` moves the epoch under a compare-and-set on the
 * epoch the caller saw, so two processes that detect one restore agree on one epoch.
 */
export function sqlScopeMarks(ctx: SqlUnitContext): ScopeMarks {
  const table = `${quoteIdentifier(ctx.namespace.root)}.kw_scope_marks`;
  const merged = (): string =>
    `position = greatest(m.position, excluded.position), serials = ${serialMarksMerge('m.serials', 'excluded.serials')}, updated_at = excluded.updated_at`;
  return {
    list: async (namespaceId, page) => {
      const rows = await sqlGuard(() =>
        runSql(ctx.db, {
          sql: `select ${columns} from ${table} where namespace_id = $1::text and ($2::text is null or scope_id::text > $2::text) order by scope_id::text limit $3::int`,
          parameters: [namespaceId, page.after ?? null, page.limit],
        }),
      );
      return rows.map(markOf);
    },
    bumped: async () => {
      const rows = await sqlGuard(() =>
        runSql(ctx.db, {
          sql: `select ${columns} from ${table} where epoch > 0 order by namespace_id, scope_id::text`,
          parameters: [],
        }),
      );
      return rows.map(markOf);
    },
    raise: async (marks) => {
      ctx.writable();
      if (marks.length === 0) return;
      await sqlGuard(async () => {
        await runSql(ctx.db, {
          sql: `insert into ${table} as m (scope_id, namespace_id, position, serials, epoch, updated_at) select s.scope_id, s.namespace_id, s.position, s.serials::jsonb, s.epoch, s.updated_at from unnest($1::uuid[], $2::text[], $3::bigint[], $4::text[], $5::int[], $6::timestamptz[]) as s(scope_id, namespace_id, position, serials, epoch, updated_at) on conflict (scope_id, namespace_id) do update set ${merged()}`,
          parameters: [
            marks.map((mark) => mark.scopeId),
            marks.map((mark) => mark.namespaceId),
            marks.map((mark) => mark.position.toString()),
            marks.map((mark) => serialsText(mark.serials)),
            marks.map((mark) => mark.epoch),
            marks.map((mark) => encodeInstant(mark.updatedAt)),
          ],
        });
      });
    },
    bump: async (mark, from) => {
      ctx.writable();
      const values = [
        mark.scopeId,
        mark.namespaceId,
        mark.position.toString(),
        serialsText(mark.serials),
        mark.epoch,
        encodeInstant(mark.updatedAt),
        from,
      ];
      return sqlGuard(async () => {
        const moved = await runSql(ctx.db, {
          sql: `update ${table} as m set epoch = $5::int, position = greatest(m.position, $3::bigint), serials = ${serialMarksMerge('m.serials', '$4::jsonb')}, updated_at = $6::timestamptz where m.scope_id = $1::uuid and m.namespace_id = $2::text and m.epoch = $7::int returning m.epoch`,
          parameters: values,
        });
        if (moved.length > 0) return mark.epoch;
        if (from === 0) {
          const inserted = await runSql(ctx.db, {
            sql: `insert into ${table} (scope_id, namespace_id, position, serials, epoch, updated_at) values ($1::uuid, $2::text, $3::bigint, $4::jsonb, $5::int, $6::timestamptz) on conflict (scope_id, namespace_id) do nothing returning epoch`,
            parameters: values.slice(0, 6),
          });
          if (inserted.length > 0) return mark.epoch;
        }
        const held = await runSql(ctx.db, {
          sql: `select epoch from ${table} where scope_id = $1::uuid and namespace_id = $2::text`,
          parameters: [mark.scopeId, mark.namespaceId],
        });
        return Number(held[0]?.epoch ?? 0);
      });
    },
  };
}
