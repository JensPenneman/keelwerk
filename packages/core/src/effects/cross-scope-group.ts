import type { JobGroup } from '../jobs/job-group.ts';

/**
 * The namespace group of the jobs a tenant's unit leaves for its backend's unit (7.9.5, 12.3): id
 * `core.cross-scope:<backend id>`, concurrency 4. Such a job stays in its tenant's lane, but its
 * command waits on the backend's row locks, shared by every tenant of the backend; the fair take
 * is per lane, so without the group a backend with thousands of tenants could hold every slot of
 * the `commands` queue on one lock. The runtime provisions the group when its directory first
 * meets the backend (`provisionBackendGroup`).
 */
export function crossScopeGroup(backendId: string): JobGroup {
  return { id: `core.cross-scope:${backendId}`, concurrency: 4, scope: 'namespace' };
}
