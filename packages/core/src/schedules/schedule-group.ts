import type { JobGroup } from '../jobs/job-group.ts';

/**
 * The namespace group that bounds an each-tenant schedule's jobs per backend (9.5.6): id
 * `core.schedule:<ref>:<backend id>`, concurrency 4, so a backend with thousands of tenants cannot
 * take every slot of the namespace's workers from the other backends.
 */
export function scheduleGroup(ref: string, backendId: string): JobGroup {
  return { id: `core.schedule:${ref}:${backendId}`, concurrency: 4, scope: 'namespace' };
}
