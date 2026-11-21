import type { PurgeBatch } from '@keelwerk/core';
import { errors, storedEventBytes } from '@keelwerk/core';
import { checkPurgeLimit } from './check-purge-limit.ts';
import { checkPurgeTypes } from './check-purge-types.ts';
import { decodeEventMeta } from './decode-event-meta.ts';
import { encodeInstant } from './encode-instant.ts';
import { purgeTransientStatement } from './postgres/purge-transient-statement.ts';
import { runSql } from './run-sql.ts';
import type { SqlCommitBuffer } from './sql-commit-buffer.ts';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';
import { storedRecordsCharge } from './stored-records-charge.ts';

/** `EventStore.purgeTransient` over `kw_events`: one call of `kw_purge_transient` in the unit, for the listed stream types only, answering the rows it deleted and whether a candidate is left. The function also answers the data, before image and meta of each row it deleted, and the bytes they were charged (`storedEventBytes`) go back to `core.eventBytes` at the unit's commit tail. */
export async function sqlPurgeTransient(
  ctx: SqlUnitContext,
  buffer: SqlCommitBuffer,
  before: Temporal.Instant,
  limit: number,
  streamTypes: readonly string[],
): Promise<PurgeBatch> {
  ctx.writable();
  checkPurgeLimit(limit);
  checkPurgeTypes(streamTypes);
  if (ctx.scope.level === 'namespace') {
    throw errors.internal('a namespace-scope unit has no event log');
  }
  const answer = await sqlGuard(() =>
    runSql(
      ctx.db,
      purgeTransientStatement(ctx.namespace.root, {
        before: encodeInstant(before),
        limit,
        streamTypes,
      }),
    ),
  );
  const row = answer[0];
  const deleted = JSON.parse(String(row?.records ?? '[]')) as readonly (readonly [
    unknown,
    unknown,
    unknown,
  ])[];
  let freed = 0n;
  for (const [data, before, meta] of deleted) {
    freed += storedEventBytes({ data, before, meta: decodeEventMeta(meta) });
  }
  buffer.charge(storedRecordsCharge(ctx.scope, -freed));
  return { removed: Number(row?.removed ?? 0), more: row?.more === true };
}
