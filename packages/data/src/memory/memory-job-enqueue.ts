import type { JobId, Scope, StorageScope, StoredJobSpec } from '@keelwerk/core';
import {
  checkLaneMembers,
  errors,
  jobPositionOf,
  KeelwerkError,
  reactionQueue,
} from '@keelwerk/core';
import { memoryAdjustLane } from './memory-adjust-lane.ts';
import { memoryCapabilitySet } from './memory-capability-set.ts';
import type { MemoryJob } from './memory-job.ts';
import { memoryJobFinish } from './memory-job-finish.ts';
import { memoryJobGroups } from './memory-job-groups.ts';
import { memoryJobRelease } from './memory-job-release.ts';
import { memoryJobTables } from './memory-job-tables.ts';
import type { MemoryLane } from './memory-lane.ts';
import { memoryParseRate } from './memory-parse-rate.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

const priorities = { high: 0, normal: 1, low: 2 } as const;

function sameScope(unit: StorageScope, job: Scope): boolean {
  switch (unit.level) {
    case 'tenant':
      return (
        job.level === 'tenant' && job.tenantId === unit.tenantId && job.backendId === unit.backendId
      );
    case 'backend':
      return job.level === 'backend' && job.backendId === unit.backendId;
    case 'deployment':
      return job.level === 'deployment';
    case 'namespace':
      return false;
  }
}

/**
 * Notes the queued cap of a lane that gained an available job, for the commit tail; the smallest
 * cap of the unit wins.
 */
function recordQueuedCap(
  ctx: MemoryUnitContext,
  scopeId: string,
  laneKey: string,
  cap: number | undefined,
): void {
  if (cap === undefined) return;
  const caps = ctx.tx.write<number>(`~queuedcap/${scopeId}`);
  caps.set(laneKey, Math.min(cap, caps.get(laneKey) ?? cap));
}

/**
 * Inserts a job in the unit of its cause (9.5.2): upserts the lane, applies the key policy to a
 * pending job of the same key and lane, and counts the job on the lane when it is due. A job whose
 * time has not come stays `scheduled`; a FIFO follower stays `waiting`. The job's scope must be
 * the unit's: no unit spans two scopes (14.3.6).
 */
export function memoryJobEnqueue(ctx: MemoryUnitContext, spec: StoredJobSpec): JobId {
  ctx.writable();
  checkLaneMembers(spec);
  const scopeId = ctx.scopeId();
  if (!sameScope(ctx.scope, spec.scope)) {
    throw new KeelwerkError({
      kind: 'forbidden',
      code: 'core.forbidden',
      message: 'a job is enqueued in a unit of its own scope',
      details: { unit: ctx.scope.level, job: spec.scope.level },
    });
  }
  if (spec.group?.scope === 'deployment') {
    throw errors.unsupported('deployment-wide job groups arrive in M2');
  }
  const tables = memoryJobTables(ctx, scopeId);
  const now = ctx.clock.now();
  const capabilitySet = memoryCapabilitySet(spec.capability);
  const priority = priorities[spec.priority ?? 'normal'];
  const laneKey = `${spec.queue}\u0000${capabilitySet}\u0000${priority}`;
  const existingLane = tables.lanes().get(laneKey);
  if (existingLane === undefined) {
    ctx.state.sequences.lane += 1;
    const lane: MemoryLane = {
      id: ctx.state.sequences.lane,
      scopeId,
      queue: spec.queue,
      capabilitySet,
      priority,
      cap: spec.laneCap,
      weight: spec.laneWeight ?? 1,
      taken: 0,
      vtime: 0,
      enqueued: 0,
      done: 0,
    };
    tables.putLane(laneKey, lane);
  } else {
    const weight = spec.laneWeight ?? existingLane.weight;
    tables.putLane(laneKey, { ...existingLane, cap: spec.laneCap, weight });
    // A new cap or weight can make waiting jobs of the lane takeable, whatever this job's own time,
    // and the SQL adapter reports the queue for the same change, for the reason `sqlJobLane` gives.
    if (existingLane.cap !== spec.laneCap || existingLane.weight !== weight) {
      ctx.readied.ready(spec.queue);
    }
  }

  const runAt = spec.runAt ?? now;
  const key = spec.key;
  const pending = (job: MemoryJob): boolean =>
    job.state === 'scheduled' || job.state === 'available' || job.state === 'waiting';
  if (key !== undefined && key.onConflict !== 'append') {
    const found = [...tables.jobs().values()].find(
      (job) => job.laneKey === laneKey && job.spec.key?.value === key.value && pending(job),
    );
    if (found !== undefined) {
      if (key.onConflict === 'keep') return String(found.id);
      if (key.onConflict === 'coalesce') {
        const earliest = Temporal.Instant.compare(runAt, found.runAt) < 0 ? runAt : found.runAt;
        const due = found.state === 'scheduled' && Temporal.Instant.compare(earliest, now) <= 0;
        tables.putJob({ ...found, runAt: earliest, state: due ? 'available' : found.state });
        if (due) {
          memoryAdjustLane(tables, laneKey, (lane) => ({ ...lane, enqueued: lane.enqueued + 1 }));
          ctx.readied.ready(spec.queue);
          recordQueuedCap(ctx, scopeId, laneKey, spec.queuedCap);
        }
        return String(found.id);
      }
      // Only a reaction job's input holds a position of the log: a module's own input is no order.
      if (spec.queue === reactionQueue) {
        const pendingAt = jobPositionOf(
          'input' in found.spec.run ? found.spec.run.input : undefined,
        );
        const newAt = jobPositionOf('input' in spec.run ? spec.run.input : undefined);
        if (pendingAt !== undefined && newAt !== undefined && pendingAt >= newAt) {
          return String(found.id);
        }
      }
      memoryJobFinish(ctx, tables, found, 'cancelled', null);
      if (found.state !== 'waiting') memoryJobRelease(ctx, tables, found);
    }
  }

  if (spec.group !== undefined) {
    const groups = memoryJobGroups(ctx);
    const spans = spec.group.scope === 'namespace';
    const before = groups.get(scopeId, spec.group.id, spans);
    const rate = spec.group.rate === undefined ? null : memoryParseRate(spec.group.rate);
    const concurrency = spec.group.concurrency ?? null;
    // New limits can free jobs of the group waiting in any queue.
    if (
      before !== undefined &&
      (before.concurrency !== concurrency ||
        before.rate?.count !== rate?.count ||
        before.rate?.periodMs !== rate?.periodMs)
    ) {
      ctx.readied.readyAnywhere();
    }
    groups.put(scopeId, spans, {
      id: spec.group.id,
      concurrency,
      running: before?.running ?? 0,
      rate,
      tokens: before?.tokens ?? rate?.count ?? 0,
      refilledAt: before?.refilledAt ?? now,
      blockedUntil: before?.blockedUntil ?? null,
    });
  }

  const follower =
    spec.ordering === 'fifo-per-key' &&
    key !== undefined &&
    [...tables.jobs().values()].some(
      (job) => job.laneKey === laneKey && job.spec.key?.value === key.value && job.state !== 'dead',
    );
  const due = Temporal.Instant.compare(runAt, now) <= 0;
  const state = follower ? 'waiting' : due ? 'available' : 'scheduled';
  ctx.state.sequences.job += 1;
  const id = ctx.state.sequences.job;
  // The cap is an instruction for the commit tail and the weight lives on the lane: a stored job,
  // like a SQL row, never holds either.
  const { laneWeight: _laneWeight, queuedCap, ...stored } = spec;
  tables.putJob({
    id,
    scopeId,
    laneKey,
    spec: stored,
    state,
    runAt,
    worker: null,
    attempt: 0,
    leaseUntil: null,
    lostLeases: 0,
    startedAt: null,
  });
  if (state === 'available') {
    memoryAdjustLane(tables, laneKey, (lane) => ({ ...lane, enqueued: lane.enqueued + 1 }));
    ctx.readied.ready(spec.queue);
    recordQueuedCap(ctx, scopeId, laneKey, queuedCap);
  }
  return String(id);
}
