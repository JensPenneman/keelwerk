import { lostLeaseWireError } from '@keelwerk/core';
import { encodeInstant } from './encode-instant.ts';
import { groupRowMissing } from './group-row-missing.ts';
import { jobUnitScopeId } from './job-unit-scope-id.ts';
import { reclaimAttemptStatement } from './postgres/reclaim-attempt-statement.ts';
import { reclaimStatement } from './postgres/reclaim-statement.ts';
import { releaseNextJobStatement } from './postgres/release-next-job-statement.ts';
import { runSql } from './run-sql.ts';
import type { SqlCommitBuffer } from './sql-commit-buffer.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * The first step of a take (9.5.4): the running jobs of the queue whose lease ended return to
 * `available` with the attempt counted as lost (`core.job_lease_lost`), and the third consecutive
 * loss makes a job a dead letter, whose FIFO successor is released. A take never waits for a lock
 * another unit holds, so it reclaims a job only where it got everything the reclaim writes: the
 * attempt statement locks the rows with `skip locked` and tries the key of a dying FIFO head
 * (`reclaimAttemptStatement`), and the jobs it got everything for are reclaimed in one more
 * statement, which moves the lanes' counters and the groups' running counts over rows the attempt
 * holds and, when a FIFO head dies, after a statement that releases the next job of each dying
 * head's key and locks that job's waiting row itself (it cannot wait: every unit that locks a
 * waiting row holds the key, which the take then holds). A job it did not get everything for stays `running` with its expired lease until
 * a later take: while another unit holds one of its rows, and for a dying head while units keep its
 * key. The job's own worker can still complete it, which is fenced on worker and attempt. A job that
 * returns to `available` stays its key's head and takes no key lock. A key the take got stays held
 * until its commit, and the rows of a job it left stay locked until then. The take does not count the
 * lanes of the jobs it left as skipped: the next take of the queue reclaims them (9.5.6).
 */
export async function sqlJobReclaim(
  ctx: SqlUnitContext,
  buffer: SqlCommitBuffer,
  queue: string,
  now: Temporal.Instant,
): Promise<void> {
  const root = ctx.namespace.root;
  const scopeId = jobUnitScopeId(ctx);
  const expired = await runSql(
    ctx.db,
    reclaimAttemptStatement(root, queue, encodeInstant(now), scopeId),
  );
  const missing = expired.find((row) => row.group_missing === true);
  if (missing !== undefined) throw groupRowMissing(String(missing.group_id));
  const ready = expired.filter((row) => row.ready === true);
  if (ready.length === 0) return;
  const heads = new Map<string, { laneId: string; key: string }>();
  for (const row of ready) {
    if (row.head === true) {
      heads.set(`${String(row.lane_id)}\u0000${String(row.key)}`, {
        laneId: String(row.lane_id),
        key: String(row.key),
      });
    }
  }
  const released =
    heads.size === 0
      ? []
      : await runSql(
          ctx.db,
          releaseNextJobStatement(root, [...heads.values()], encodeInstant(now), scopeId),
        );
  const followerLanes = released
    .filter((row) => row.state === 'available')
    .map((row) => String(row.lane_id));
  const reclaimed = await runSql(
    ctx.db,
    reclaimStatement({
      root,
      returning: ready.filter((row) => row.dies !== true).map((row) => String(row.id)),
      dying: ready.filter((row) => row.dies === true).map((row) => String(row.id)),
      followerLanes,
      now: encodeInstant(now),
      deadError: JSON.stringify(lostLeaseWireError),
    }),
  );
  if (reclaimed.some((row) => row.group_id !== null)) buffer.readyAnywhere();
  else buffer.ready(queue);
}
