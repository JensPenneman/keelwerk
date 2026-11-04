import type { JobGroup } from '@keelwerk/core';

/**
 * The key a group has in `kw_job_groups.id` and `kw_jobs.group_id`: the declared id, bare
 * (`'mx:example.com'`, `'backend:<id>'`, 9.5.2). The scope is never encoded into the id; it is the
 * `scope_id` column, and `kw_job_groups` is keyed by (`scope_id`, `id`).
 */
export function sqlJobGroupKey(group: JobGroup): string {
  return group.id;
}
