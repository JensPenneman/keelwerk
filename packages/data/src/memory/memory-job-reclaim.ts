import { memoryAdjustLane } from './memory-adjust-lane.ts';
import { memoryJobFinish } from './memory-job-finish.ts';
import { memoryJobGroups } from './memory-job-groups.ts';
import { memoryJobScopes } from './memory-job-scopes.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

const lostLeaseError = {
  kind: 'unavailable',
  code: 'core.job_lease_lost',
  message: 'The worker lost its lease on the job.',
  retryable: true,
  requestId: '',
} as const;

/**
 * Returns the jobs of a queue whose lease expired to `available` (9.5.4), the attempt counted as
 * lost; three consecutive lost leases make the job a dead letter, so a poison job cannot take the
 * fleet down one process at a time.
 */
export function memoryJobReclaim(ctx: MemoryUnitContext, queue: string): void {
  const now = ctx.clock.now();
  const groups = memoryJobGroups(ctx);
  for (const tables of memoryJobScopes(ctx)) {
    for (const job of tables.jobs().values()) {
      if (job.state !== 'running' || job.spec.queue !== queue || job.leaseUntil === null) continue;
      if (Temporal.Instant.compare(job.leaseUntil, now) >= 0) continue;
      const spans = job.spec.group?.scope === 'namespace';
      const group =
        job.spec.group === undefined
          ? undefined
          : groups.get(job.scopeId, job.spec.group.id, spans);
      if (group !== undefined)
        groups.put(job.scopeId, spans, { ...group, running: group.running - 1 });
      const lost = job.lostLeases + 1;
      if (lost >= 3) {
        memoryJobFinish(ctx, tables, { ...job, lostLeases: lost }, 'dead', lostLeaseError);
        continue;
      }
      memoryAdjustLane(tables, job.laneKey, (lane) => ({ ...lane, taken: lane.taken - 1 }));
      tables.putJob({
        ...job,
        state: 'available',
        worker: null,
        leaseUntil: null,
        lostLeases: lost,
      });
    }
  }
}
