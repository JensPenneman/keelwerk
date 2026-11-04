import type { JobGroup } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import type { SqlUnitContext } from './sql-unit-context.ts';
import { unitGroupTarget } from './unit-group-target.ts';
import { upsertJobGroup } from './upsert-job-group.ts';

/**
 * Creates or re-limits the row of a group that spans the namespace's scopes; only a namespace-scope
 * unit may write it, so a tenant unit never takes a lock that other tenants wait on.
 */
export async function provisionJobGroup(ctx: SqlUnitContext, group: JobGroup): Promise<void> {
  ctx.writable();
  if (ctx.scope.level !== 'namespace' || group.scope !== 'namespace') {
    throw errors.internal('a namespace job group is provisioned by a namespace-scope unit only');
  }
  await upsertJobGroup(unitGroupTarget(ctx), group, null);
}
