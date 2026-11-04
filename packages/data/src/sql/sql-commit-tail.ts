import type { StreamRef } from '@keelwerk/core';
import { errors, KeelwerkError } from '@keelwerk/core';
import { mapSqlError } from './map-sql-error.ts';
import { pendingTailEvent } from './pending-tail-event.ts';
import { commitTailStatement } from './postgres/commit-tail-statement.ts';
import { runSql } from './run-sql.ts';
import type { SqlCommitBuffer } from './sql-commit-buffer.ts';
import { sqlEventBackendId } from './sql-event-backend-id.ts';
import type { SqlPendingEvent } from './sql-pending-event.ts';
import { sqlStreamKey } from './sql-stream-key.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';
import { streamVersionConflict } from './stream-version-conflict.ts';

/**
 * The streams of the buffered events whose position did not come back from the statement's
 * `appended` rows: the statement skips a version another unit took first instead of raising, since
 * a unique violation's detail is hidden from a role without `BYPASSRLS`. The event at index `i` is
 * written at `first + i`, so the match does not depend on how the database spells a stream id.
 */
function missingStreams(
  pending: readonly SqlPendingEvent[],
  first: bigint,
  appended: unknown,
): readonly StreamRef[] {
  const written = new Set(
    (JSON.parse(String(appended)) as readonly (string | number)[]).map(BigInt),
  );
  const missing = new Map<string, StreamRef>();
  pending.forEach((event, index) => {
    if (!written.has(first + BigInt(index))) missing.set(sqlStreamKey(event.stream), event.stream);
  });
  return [...missing.values()];
}

/**
 * The commit tail of the unit (15.1.4, decision 112), run once just before the transaction
 * commits: one statement that advances the scope's counter, inserts the buffered events at the
 * positions it opens and moves the `enqueued` counters of the lanes that gained jobs. A buffered
 * event the statement did not insert means another unit appended the same stream version first,
 * which is the expected-version conflict, named per stream; the unit's rollback gives the counter
 * back; the lane counters it moved are checked, because a counter row
 * the unit's row-level security hides is updated zero times without an error.
 */
export async function runCommitTail(ctx: SqlUnitContext, buffer: SqlCommitBuffer): Promise<void> {
  const sums = new Map<string, number>();
  for (const lane of buffer.lanes) {
    sums.set(lane.laneId, (sums.get(lane.laneId) ?? 0) + lane.delta);
  }
  const lanes = [...sums]
    .filter(([, delta]) => delta !== 0)
    .map(([laneId, delta]) => ({ laneId, delta }))
    .sort((left, right) => {
      const [a, b] = [BigInt(left.laneId), BigInt(right.laneId)];
      return a < b ? -1 : a > b ? 1 : 0;
    });
  const pending = buffer.events;
  if (pending.length === 0 && lanes.length === 0) return;
  const statement = commitTailStatement({
    root: ctx.namespace.root,
    scopeId: ctx.scope.level === 'namespace' ? null : ctx.scopeId(),
    backendId: pending.length > 0 ? sqlEventBackendId(ctx) : '',
    events: pending.map(pendingTailEvent),
    lanes,
  });
  const rows = await runSql(ctx.db, statement).catch((error: unknown) => {
    throw mapSqlError(error);
  });
  const row = rows[0];
  if (row === undefined) throw errors.internal('the commit tail answered nothing');
  if (pending.length > 0) {
    const streams = missingStreams(pending, BigInt(String(row.first)), row.appended);
    const [only] = streams;
    if (streams.length === 1 && only !== undefined) {
      throw streamVersionConflict(only, undefined, undefined);
    }
    if (streams.length > 1) {
      throw new KeelwerkError({
        kind: 'conflict',
        code: 'core.version_mismatch',
        message: 'The stream changed since it was read.',
        details: { streams },
      });
    }
  }
  if (Number(row.lanes) !== lanes.length) {
    throw errors.internal(
      `a lane counter row is missing or hidden from the unit (${Number(row.lanes)} of ${lanes.length} moved)`,
    );
  }
  if (pending.length > 0) {
    const first = BigInt(String(row.first));
    for (let index = 0; index < pending.length; index += 1) {
      buffer.assigned.push(first + BigInt(index));
    }
  }
}
