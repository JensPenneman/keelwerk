import { encodeInstant } from './encode-instant.ts';
import { jobUnitScopeId } from './job-unit-scope-id.ts';
import { releaseNextJobStatement } from './postgres/release-next-job-statement.ts';
import { runSql } from './run-sql.ts';
import type { SqlCommitBuffer } from './sql-commit-buffer.ts';
import { sqlJobKeyLock } from './sql-job-key-lock.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * FIFO per key (9.1.2, 9.5.2): when the head of a key leaves the queue, the key's next `waiting`
 * job becomes `available` (or `scheduled`, when its time has not come) and, when available, is
 * counted on its lane at the commit tail; `queue` is the queue of the lane, recorded as takeable.
 * The key's advisory lock is taken first, the one an append under the key holds until it commits: a
 * job appended while the head ends is either seen by the append as having no head, or released here
 * once the append has committed. The callers (completion, purge, the replace of an enqueue) take it
 * before their rows and so hold it already; this call is the guard for a caller that does not. A
 * take that ends a dead head does not come here: it tries the lock, and releases the key in its own
 * statements (`sqlJobReclaim`).
 */
export async function sqlJobRelease(
  ctx: SqlUnitContext,
  buffer: SqlCommitBuffer,
  queue: string,
  laneId: string,
  key: string,
): Promise<void> {
  await sqlJobKeyLock(ctx, laneId, key);
  const [released] = await runSql(
    ctx.db,
    releaseNextJobStatement(
      ctx.namespace.root,
      [{ laneId, key }],
      encodeInstant(ctx.clock.now()),
      jobUnitScopeId(ctx),
    ),
  );
  if (released?.state === 'available') {
    buffer.moveLane(laneId, 1);
    buffer.ready(queue);
  }
}
