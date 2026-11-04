import type { StoredJob } from '@keelwerk/core';
import type { MemoryJob } from './memory-job.ts';
import { memoryJobGroups } from './memory-job-groups.ts';
import { memoryJobReclaim } from './memory-job-reclaim.ts';
import { memoryJobScopes } from './memory-job-scopes.ts';
import type { MemoryJobTables } from './memory-job-tables.ts';
import type { MemoryLane } from './memory-lane.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

interface TakeRequest {
  readonly limit: number;
  readonly lanes?: number;
  readonly capabilitySets: readonly string[];
  readonly maxRevision: number;
  readonly leaseMs: number;
}

interface PickedLane {
  readonly tables: MemoryJobTables;
  readonly key: string;
  readonly lane: MemoryLane;
}

/** Jobs of a lane that a taker may start: available, within its revision. */
function takeable(tables: MemoryJobTables, lane: MemoryLane, maxRevision: number): MemoryJob[] {
  return [...tables.jobs().values()]
    .filter(
      (job) =>
        job.state === 'available' &&
        job.laneKey === `${lane.queue}\u0000${lane.capabilitySet}\u0000${lane.priority}` &&
        job.spec.build.revision <= maxRevision,
    )
    .sort((a, b) => Temporal.Instant.compare(a.runAt, b.runAt) || a.id - b.id);
}

/**
 * The fair take of 9.5.3 under the single writer: strict priority classes, then the least running
 * work per unit of weight, then virtual time (a weighted round robin whose idle lanes are lifted
 * to the least virtual time of the lanes with work). A lane never runs more than its cap; a job
 * whose group is blocked, full or out of tokens stays available. Expired leases are reclaimed
 * first. Under one writer no lane is ever locked by another taker, so `skippedLanes` is 0.
 */
export function memoryJobTake(
  ctx: MemoryUnitContext,
  queue: string,
  worker: string,
  request: TakeRequest,
): { readonly jobs: readonly StoredJob[]; readonly skippedLanes: number } {
  ctx.writable();
  memoryJobReclaim(ctx, queue);
  const now = ctx.clock.now();
  const candidates: PickedLane[] = [];
  for (const tables of memoryJobScopes(ctx)) {
    for (const [key, lane] of tables.lanes()) {
      if (lane.queue === queue && request.capabilitySets.includes(lane.capabilitySet)) {
        candidates.push({ tables, key, lane });
      }
    }
  }
  const withWork = candidates.filter(({ lane }) => lane.enqueued > lane.taken);
  if (withWork.length === 0) return { jobs: [], skippedLanes: 0 };
  const floor = Math.min(...withWork.map(({ lane }) => lane.vtime));
  const picked = withWork
    .filter(({ lane }) => lane.taken - lane.done < lane.cap)
    .sort((a, b) => {
      const load = (lane: MemoryLane): number => (lane.taken - lane.done) / lane.weight;
      return (
        a.lane.priority - b.lane.priority ||
        load(a.lane) - load(b.lane) ||
        Math.max(a.lane.vtime, floor) - Math.max(b.lane.vtime, floor) ||
        a.lane.id - b.lane.id
      );
    })
    .slice(0, request.lanes ?? request.limit);
  if (picked.length === 0) return { jobs: [], skippedLanes: 0 };
  const share = Math.max(1, Math.ceil(request.limit / picked.length));
  const groups = memoryJobGroups(ctx);
  const taken: StoredJob[] = [];
  for (const { tables, key, lane } of picked) {
    const room = lane.cap - (lane.taken - lane.done);
    let count = 0;
    let cost = 0;
    for (const job of takeable(tables, lane, request.maxRevision)) {
      if (count >= Math.min(room, share) || taken.length >= request.limit) break;
      const spec = job.spec.group;
      if (spec !== undefined) {
        const spans = spec.scope === 'namespace';
        const group = groups.get(job.scopeId, spec.id, spans);
        if (group !== undefined) {
          if (group.blockedUntil !== null && Temporal.Instant.compare(group.blockedUntil, now) > 0)
            continue;
          if (group.concurrency !== null && group.running >= group.concurrency) continue;
          let tokens = group.tokens;
          let blockedUntil = group.blockedUntil;
          if (group.rate !== null) {
            const elapsed = now.epochMilliseconds - group.refilledAt.epochMilliseconds;
            tokens = Math.min(
              group.rate.count,
              tokens + (elapsed * group.rate.count) / group.rate.periodMs,
            );
            if (tokens < 1) {
              const wait = Math.ceil(((1 - tokens) * group.rate.periodMs) / group.rate.count);
              groups.put(job.scopeId, spans, {
                ...group,
                tokens,
                refilledAt: now,
                blockedUntil: now.add({ milliseconds: wait }),
              });
              continue;
            }
            tokens -= 1;
            blockedUntil = null;
          }
          groups.put(job.scopeId, spans, {
            ...group,
            running: group.running + 1,
            tokens,
            refilledAt: group.rate === null ? group.refilledAt : now,
            blockedUntil,
          });
        }
      }
      const running: MemoryJob = {
        ...job,
        state: 'running',
        worker,
        attempt: job.attempt + 1,
        leaseUntil: now.add({ milliseconds: request.leaseMs }),
        startedAt: job.startedAt ?? now,
      };
      tables.putJob(running);
      count += 1;
      cost += job.spec.cost ?? 1;
      taken.push({
        ...job.spec,
        id: String(job.id),
        runAt: job.runAt,
        attempt: { jobId: String(job.id), attempt: running.attempt },
      });
    }
    if (count > 0) {
      tables.putLane(key, {
        ...lane,
        taken: lane.taken + count,
        vtime: Math.max(lane.vtime, floor) + cost / lane.weight,
      });
    }
  }
  return { jobs: taken, skippedLanes: 0 };
}
