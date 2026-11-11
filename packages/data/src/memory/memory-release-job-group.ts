import type { MemoryJob } from './memory-job.ts';
import { memoryJobGroups } from './memory-job-groups.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/** Gives the running slot of a job's group back, when the job has a group. */
export function memoryReleaseJobGroup(ctx: MemoryUnitContext, job: MemoryJob): void {
  if (job.spec.group === undefined) return;
  const groups = memoryJobGroups(ctx);
  const spans = job.spec.group.scope === 'namespace';
  const group = groups.get(job.scopeId, job.spec.group.id, spans);
  if (group !== undefined) groups.put(job.scopeId, spans, { ...group, running: group.running - 1 });
}
