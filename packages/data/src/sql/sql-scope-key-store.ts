// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { ScopeKeyStore, WrappedScopeKey } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { decodeInstant } from './decode-instant.ts';
import { encodeInstant } from './encode-instant.ts';
import { decodeBytes } from './sql-bytes.ts';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Raw = Readonly<Record<string, unknown>>;

function keyOf(row: Raw): WrappedScopeKey {
  return {
    scopeId: String(row.scope_id),
    level: String(row.level) as WrappedScopeKey['level'],
    version: Number(row.version),
    wrapped: decodeBytes(row.wrapped),
    createdAt: decodeInstant(row.created_at),
    retiredAt: row.retired_at === null ? null : decodeInstant(row.retired_at),
  };
}

const columns = ['scope_id', 'level', 'version', 'wrapped', 'created_at', 'retired_at'] as const;

/**
 * The wrapped deployment, backend and tenant keys of the control root (S-55, 14.7.4). Only a
 * deployment-scope unit has this store: the table is outside the scope predicate because it holds
 * every scope's keys, and its policy admits units that name the deployment.
 */
export function sqlScopeKeyStore(ctx: SqlUnitContext): ScopeKeyStore {
  const table = ctx.table('kw_scope_keys');
  const select = () =>
    ctx
      .controlDb()
      .selectFrom(table)
      .select([...columns]);
  return {
    current: async (scopeId) => {
      if (!uuidPattern.test(scopeId)) return undefined;
      const row = await sqlGuard(async () =>
        select()
          .where('scope_id', '=', scopeId)
          .where('retired_at', 'is', null)
          .orderBy('version', 'desc')
          .executeTakeFirst(),
      );
      return row === undefined ? undefined : keyOf(row);
    },
    byVersion: async (scopeId, version) => {
      if (!uuidPattern.test(scopeId)) return undefined;
      const row = await sqlGuard(async () =>
        select().where('scope_id', '=', scopeId).where('version', '=', version).executeTakeFirst(),
      );
      return row === undefined ? undefined : keyOf(row);
    },
    add: async (key) => {
      ctx.writable();
      await sqlGuard(async () => {
        await ctx
          .controlDb()
          .insertInto(table)
          .values({
            scope_id: key.scopeId,
            level: key.level,
            version: key.version,
            wrapped: Buffer.from(key.wrapped),
            created_at: encodeInstant(key.createdAt),
            retired_at: key.retiredAt === null ? null : encodeInstant(key.retiredAt),
          })
          .execute();
      });
    },
    retire: async (scopeId, version, at) => {
      ctx.writable();
      if (!uuidPattern.test(scopeId)) {
        throw errors.not_found(`scope ${scopeId} has no key version ${version}`);
      }
      const result = await sqlGuard(async () =>
        ctx
          .controlDb()
          .updateTable(table)
          .set({ retired_at: encodeInstant(at) })
          .where('scope_id', '=', scopeId)
          .where('version', '=', version)
          .executeTakeFirst(),
      );
      if (result.numUpdatedRows === 0n) {
        throw errors.not_found(`scope ${scopeId} has no key version ${version}`);
      }
    },
    destroy: async (scopeId) => {
      ctx.writable();
      if (!uuidPattern.test(scopeId)) return;
      await sqlGuard(async () => {
        await ctx.controlDb().deleteFrom(table).where('scope_id', '=', scopeId).execute();
      });
    },
  };
}
