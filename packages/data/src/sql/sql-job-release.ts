import { encodeInstant } from './encode-instant.ts';
import { quoteIdentifier } from './postgres/quote-identifier.ts';
import { runSql } from './run-sql.ts';
import type { SqlCommitBuffer } from './sql-commit-buffer.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * FIFO per key (9.1.2, 9.5.2): when the head of a key leaves the queue, the key's next `waiting`
 * job becomes `available` (or `scheduled`, when its time has not come) and, when available, is
 * counted on its lane at the commit tail.
 */
export async function sqlJobRelease(
  ctx: SqlUnitContext,
  buffer: SqlCommitBuffer,
  laneId: string,
  key: string,
): Promise<void> {
  const root = quoteIdentifier(ctx.namespace.root);
  const parameters: unknown[] = [laneId, key, encodeInstant(ctx.clock.now())];
  let scoped = '';
  if (ctx.scope.level !== 'namespace') {
    parameters.push(ctx.scopeId());
    scoped = ' and scope_id = $4::uuid';
  }
  const [released] = await runSql(ctx.db, {
    sql: `update ${root}.kw_jobs set state = case when run_at <= $3::timestamptz then 'available' else 'scheduled' end
where id = (
  select id from ${root}.kw_jobs where lane_id = $1::bigint and key = $2 and state = 'waiting'${scoped}
  order by id limit 1 for update
)${scoped}
returning state`,
    parameters,
  });
  if (released?.state === 'available') buffer.moveLane(laneId, 1);
}
