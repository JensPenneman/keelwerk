import type { JobGroup } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { quoteIdentifier } from './postgres/quote-identifier.ts';
import { runSql } from './run-sql.ts';
import { sqlJobGroupKey } from './sql-job-group-key.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';
import { upsertJobGroup } from './upsert-job-group.ts';

/**
 * Makes sure the group's counter row exists with the job's concurrency and rate (9.5.2, S-07):
 * a new row starts with a full token bucket, an existing one keeps its counters and takes the
 * limits only when they changed, so enqueues of one group do not hold its row lock otherwise.
 * `kw_job_groups.scope_id` is null for a group that spans the namespace's scopes. Such a group
 * is created and re-limited only in a namespace-scope unit; any other unit only reads it, since
 * writing its row would make tenants wait on each other (15.1.4), and enqueueing into one that is
 * not provisioned fails with `internal`.
 */
export async function sqlJobGroup(ctx: SqlUnitContext, group: JobGroup): Promise<string> {
  const root = quoteIdentifier(ctx.namespace.root);
  const key = sqlJobGroupKey(group);
  if (group.scope === 'namespace' && ctx.scope.level !== 'namespace') {
    const [found] = await runSql(ctx.db, {
      sql: `select 1 as found from ${root}.kw_job_groups where id = $1 and scope_id is null`,
      parameters: [key],
    });
    if (found === undefined) {
      throw errors.internal(`the namespace job group ${key} is not provisioned`);
    }
    return key;
  }
  return upsertJobGroup(ctx, group, group.scope === 'namespace' ? null : ctx.scopeId());
}
