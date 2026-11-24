import type { ControlLeaseStore } from '@keelwerk/core';
import { checkLeaseParts } from './check-lease-parts.ts';
import { checkLeaseRenewal } from './check-lease-renewal.ts';
import { encodeInstant } from './encode-instant.ts';
import { runSql } from './run-sql.ts';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/** `kw_leases` of the control root (S-120), shared by PGlite and `pg`; deployment-scope units only. */
export function sqlControlLeases(ctx: SqlUnitContext): ControlLeaseStore {
  const table = ctx.table('kw_leases');
  const now = (): string => encodeInstant(ctx.clock.now());
  const lock = async (kind: string, key: string): Promise<void> => {
    await runSql(ctx.db, {
      sql: 'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      parameters: [`keelwerk:lease:${kind}:${key}`],
    });
  };
  const totalOf = async (kind: string, key: string): Promise<number> => {
    const rows = await runSql(ctx.db, {
      sql: `select coalesce(sum(units), 0)::text as total from ${table} where kind = $1 and key = $2 and expires_at > $3::timestamptz`,
      parameters: [kind, key, now()],
    });
    return Number(rows[0]?.total ?? 0);
  };
  return {
    hold: async (lease, ttlMs) => {
      checkLeaseParts({ ...lease, ttlMs });
      ctx.writable();
      const expiresAt = encodeInstant(ctx.clock.now().add({ milliseconds: ttlMs }));
      return sqlGuard(async () => {
        await lock(lease.kind, lease.key);
        await runSql(ctx.db, {
          sql: `insert into ${table} (kind, scope_id, key, holder, units, expires_at) values ($1, $2::uuid, $3, $4, $5::int, $6::timestamptz) on conflict (kind, key, holder) do update set scope_id = excluded.scope_id, units = excluded.units, expires_at = excluded.expires_at`,
          parameters: [lease.kind, lease.scopeId, lease.key, lease.holder, lease.units, expiresAt],
        });
        return { total: await totalOf(lease.kind, lease.key) };
      });
    },
    renew: async (holder, leases, ttlMs) => {
      checkLeaseRenewal(holder, leases, ttlMs);
      ctx.writable();
      if (leases.length === 0) return [];
      const expiresAt = encodeInstant(ctx.clock.now().add({ milliseconds: ttlMs }));
      const rows = await sqlGuard(() =>
        runSql(ctx.db, {
          sql: `with p as (select kind, key, scope_id, units, ord from unnest($1::text[], $2::text[], $3::text[], $4::int[]) with ordinality as t (kind, key, scope_id, units, ord)), before as (select l.kind, l.key from ${table} l join p on l.kind = p.kind and l.key = p.key where l.holder = $5 and l.expires_at > $6::timestamptz), gone as (delete from ${table} l using p where l.kind = p.kind and l.key = p.key and l.holder = $5 and p.units = 0 returning 1), written as (insert into ${table} (kind, scope_id, key, holder, units, expires_at) select kind, scope_id::uuid, key, $5, units, $7::timestamptz from p where units > 0 on conflict (kind, key, holder) do update set scope_id = excluded.scope_id, units = excluded.units, expires_at = excluded.expires_at returning 1) select p.ord, not exists (select 1 from before b where b.kind = p.kind and b.key = p.key) as lapsed, (p.units + coalesce((select sum(x.units) from ${table} x where x.kind = p.kind and x.key = p.key and x.holder <> $5 and x.expires_at > $6::timestamptz), 0))::text as total from p order by p.ord`,
          parameters: [
            leases.map((lease) => lease.kind),
            leases.map((lease) => lease.key),
            leases.map((lease) => lease.scopeId),
            leases.map((lease) => lease.units),
            holder,
            now(),
            expiresAt,
          ],
        }),
      );
      return rows.map((row) => ({ total: Number(row.total), lapsed: row.lapsed === true }));
    },
    release: async (kind, key, holder) => {
      checkLeaseParts({ kind, key, holder });
      ctx.writable();
      await sqlGuard(async () => {
        await lock(kind, key);
        await runSql(ctx.db, {
          sql: `delete from ${table} where kind = $1 and key = $2 and holder = $3`,
          parameters: [kind, key, holder],
        });
      });
    },
    total: async (kind, key) => {
      checkLeaseParts({ kind, key });
      return sqlGuard(() => totalOf(kind, key));
    },
    expire: async (kind, limit) => {
      checkLeaseParts({ kind, limit });
      ctx.writable();
      const rows = await sqlGuard(() =>
        runSql(ctx.db, {
          sql: `with picked as (select kind, key, holder from ${table} where kind = $1 and expires_at <= $2::timestamptz order by expires_at, key, holder limit $3::int for update skip locked), gone as (delete from ${table} l using picked p where l.kind = p.kind and l.key = p.key and l.holder = p.holder returning l.scope_id::text as scope_id, l.key) select distinct g.scope_id, g.key from gone g where not exists (select 1 from ${table} x where x.kind = $1 and x.key = g.key and x.expires_at > $2::timestamptz)`,
          parameters: [kind, now(), limit],
        }),
      );
      return rows.map((row) => ({
        scopeId: row.scope_id === null ? null : String(row.scope_id),
        key: String(row.key),
      }));
    },
  };
}
