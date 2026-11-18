// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { NamespaceIdentities } from '@keelwerk/core';
import { decodeInstant } from './decode-instant.ts';
import { encodeInstant } from './encode-instant.ts';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/** `kw_namespace_identities` of the control root (14.7.6, S-119); only a deployment-scope unit has this store. */
export function sqlNamespaceIdentities(ctx: SqlUnitContext): NamespaceIdentities {
  const table = ctx.table('kw_namespace_identities');
  return {
    all: async () => {
      const rows = await sqlGuard(async () =>
        ctx
          .controlDb()
          .selectFrom(table)
          .select(['namespace_id', 'system_id', 'timeline', 'recorded_at'])
          .orderBy('namespace_id')
          .execute(),
      );
      return rows.map((row) => ({
        namespaceId: String(row.namespace_id),
        systemId: String(row.system_id),
        timeline: String(row.timeline),
        recordedAt: decodeInstant(row.recorded_at),
      }));
    },
    record: async (identity) => {
      ctx.writable();
      await sqlGuard(async () => {
        await ctx
          .controlDb()
          .insertInto(table)
          .values({
            namespace_id: identity.namespaceId,
            system_id: identity.systemId,
            timeline: identity.timeline,
            recorded_at: encodeInstant(identity.recordedAt),
          })
          .onConflict((conflict) =>
            conflict.column('namespace_id').doUpdateSet({
              system_id: identity.systemId,
              timeline: identity.timeline,
              recorded_at: encodeInstant(identity.recordedAt),
            }),
          )
          .execute();
      });
    },
  };
}
