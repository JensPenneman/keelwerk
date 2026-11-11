import type { JobGroup, JobId, JobStore, Scope, StorageScope, StoredJobSpec } from '@keelwerk/core';
import { errors, jobPositionOf, reactionQueue } from '@keelwerk/core';
import { decodeInstant } from './decode-instant.ts';
import { encodeInstant } from './encode-instant.ts';
import { jobCapabilitySet } from './job-capability-set.ts';
import { jobPriority } from './job-priority.ts';
import { quoteIdentifier } from './postgres/quote-identifier.ts';
import { provisionJobGroup } from './provision-job-group.ts';
import { runSql } from './run-sql.ts';
import { scopeForbidden } from './scope-forbidden.ts';
import type { SqlCommitBuffer } from './sql-commit-buffer.ts';
import { sqlGuard } from './sql-guard.ts';
import { sqlJobCancel } from './sql-job-cancel.ts';
import { sqlJobComplete } from './sql-job-complete.ts';
import { sqlJobGroup } from './sql-job-group.ts';
import { sqlJobHeartbeat } from './sql-job-heartbeat.ts';
import { sqlJobLane } from './sql-job-lane.ts';
import { sqlJobPromote } from './sql-job-promote.ts';
import { sqlJobRelease } from './sql-job-release.ts';
import { sqlJobStats } from './sql-job-stats.ts';
import { sqlJobTake } from './sql-job-take.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

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

const pending = `('scheduled', 'available', 'waiting')`;

/** The job store of a unit (14.3.9) without `schedules()` (S-03), plus the provisioning of namespace groups. */
export interface SqlJobStore
  extends Pick<
    JobStore,
    'cancel' | 'complete' | 'enqueue' | 'heartbeat' | 'promote' | 'stats' | 'take'
  > {
  /**
   * Creates or re-limits a job group that spans the namespace's scopes; only a namespace-scope unit
   * may call it, any other fails with `internal`. Tenant enqueues only read such a group.
   */
  provisionGroup(group: JobGroup): Promise<void>;
}

/**
 * The job store on the PostgreSQL dialect (9.5.2 to 9.5.4, 14.3.9). Promotion, the fair take,
 * heartbeats, completion and statistics live in `sqlJobPromote`, `sqlJobTake`, `sqlJobHeartbeat`,
 * `sqlJobComplete` and `sqlJobStats`; a completion gives its counters back at the end of its unit,
 * before the commit tail. Enqueue and cancel run in the unit of the cause. Enqueue upserts the lane (scope, queue, capability set, priority) and its two counter rows, applies the
 * key policy to a pending job of the same key and lane (`keep`, `replace`, `coalesce`; `append` looks nothing up), keeps the
 * group's counter row, and inserts the job: `available` when due, `scheduled` when its time has
 * not come, `waiting` behind an earlier job of the same key when the queue orders by key. A job
 * that becomes available moves its lane's `enqueued` counter at the commit tail (`runCommitTail`),
 * beside the scope's position counter. Concurrent units that enqueue under one key serialise on a
 * transaction-scoped advisory lock of lane and key, so the policy sees every earlier decision.
 * A job's unit is its scope's: no unit spans two scopes (14.3.6).
 */
export function sqlJobStore(ctx: SqlUnitContext, buffer: SqlCommitBuffer): SqlJobStore {
  const root = quoteIdentifier(ctx.namespace.root);
  return {
    provisionGroup: async (group) => sqlGuard(async () => provisionJobGroup(ctx, group)),
    enqueue: async (spec: StoredJobSpec): Promise<JobId> => {
      ctx.writable();
      const scopeId = ctx.scopeId();
      if (!sameScope(ctx.scope, spec.scope)) {
        throw scopeForbidden('a job is enqueued in a unit of its own scope', {
          unit: ctx.scope.level,
          job: spec.scope.level,
        });
      }
      if (spec.group?.scope === 'deployment') {
        throw errors.unsupported('deployment-wide job groups arrive in M2');
      }
      return sqlGuard(async () => {
        const now = ctx.clock.now();
        const laneId = await sqlJobLane(ctx, {
          queue: spec.queue,
          capabilitySet: jobCapabilitySet(spec.capability),
          priority: jobPriority(spec.priority),
          cap: spec.laneCap,
        });
        const runAt = spec.runAt ?? now;
        const due = Temporal.Instant.compare(runAt, now) <= 0;
        const key = spec.key;
        if (key !== undefined) {
          await runSql(ctx.db, {
            sql: 'select pg_advisory_xact_lock(hashtextextended($1, 0))',
            parameters: [`${ctx.namespace.root}:${laneId}:${key.value}`],
          });
          // `append` looks nothing up: the job joins the key's FIFO below.
          const [found] =
            key.onConflict === 'append'
              ? []
              : await runSql(ctx.db, {
                  sql: `select id::text as id, state, run_at, ordering, input->'input'->>'position' as position from ${root}.kw_jobs
where scope_id = $3::uuid and lane_id = $1::bigint and key = $2 and state in ${pending}
order by id limit 1 for update`,
                  parameters: [laneId, key.value, scopeId],
                });
          if (found !== undefined) {
            const foundId = String(found.id);
            if (key.onConflict === 'keep') return foundId;
            if (key.onConflict === 'coalesce') {
              const foundAt = decodeInstant(found.run_at);
              const earliest = Temporal.Instant.compare(runAt, foundAt) < 0 ? runAt : foundAt;
              const becomesDue =
                found.state === 'scheduled' && Temporal.Instant.compare(earliest, now) <= 0;
              await runSql(ctx.db, {
                sql: `update ${root}.kw_jobs set run_at = $2::timestamptz, state = case when $3::boolean then 'available' else state end
where id = $1::bigint and scope_id = $4::uuid`,
                parameters: [foundId, encodeInstant(earliest), String(becomesDue), scopeId],
              });
              if (becomesDue) buffer.moveLane(laneId, 1);
              return foundId;
            }
            // Only a reaction job's input holds a position of the log: a module's own input is no order.
            if (spec.queue === reactionQueue) {
              const pendingAt = jobPositionOf({ position: found.position });
              const newAt = jobPositionOf('input' in spec.run ? spec.run.input : undefined);
              if (pendingAt !== undefined && newAt !== undefined && pendingAt >= newAt) {
                return foundId;
              }
            }
            await sqlJobCancel(ctx, buffer, { ids: [foundId] });
            if (found.state !== 'waiting' && found.ordering === 'fifo-per-key') {
              await sqlJobRelease(ctx, buffer, laneId, key.value);
            }
          }
        }
        const groupKey = spec.group === undefined ? null : await sqlJobGroup(ctx, spec.group);
        let follower = false;
        if (spec.ordering === 'fifo-per-key' && key !== undefined) {
          const [ahead] = await runSql(ctx.db, {
            sql: `select 1 as ahead from ${root}.kw_jobs where scope_id = $3::uuid and lane_id = $1::bigint and key = $2 and state <> 'dead' limit 1`,
            parameters: [laneId, key.value, scopeId],
          });
          follower = ahead !== undefined;
        }
        const state = follower ? 'waiting' : due ? 'available' : 'scheduled';
        const [inserted] = await runSql(ctx.db, {
          sql: `insert into ${root}.kw_jobs (scope_id, scope, lane_id, queue, kind, state, run_at, principal, causation,
  build_id, revision, api_version, ordering, group_id, group_spec, key, cost, retry, heartbeat_seconds,
  expire_in_seconds, dead_letter, input, created_at)
values ($1::uuid, $23::jsonb, $2::bigint, $3, $4, $5, $6::timestamptz, $7::jsonb, $8::jsonb, $9, $10::integer, $11, $12,
  $13, $14::jsonb, $15, $16::integer, $17::jsonb, $18::integer, $19::integer, $20, $21::jsonb, $22::timestamptz)
returning id::text as id`,
          parameters: [
            scopeId,
            laneId,
            spec.queue,
            spec.kind,
            state,
            encodeInstant(runAt),
            JSON.stringify(spec.principal),
            JSON.stringify(spec.causation),
            spec.build.id,
            String(spec.build.revision),
            spec.apiVersion ?? null,
            spec.ordering ?? 'none',
            groupKey,
            spec.group === undefined ? null : JSON.stringify(spec.group),
            key?.value ?? null,
            String(spec.cost ?? 1),
            spec.retry === undefined ? null : JSON.stringify(spec.retry),
            String(spec.heartbeatSeconds ?? 10),
            spec.expireInSeconds === undefined ? null : String(spec.expireInSeconds),
            spec.deadLetter ?? null,
            JSON.stringify(spec.run),
            encodeInstant(spec.createdAt),
            JSON.stringify(spec.scope),
          ],
        });
        if (inserted === undefined) throw errors.internal('the job insert answered nothing');
        if (state === 'available') buffer.moveLane(laneId, 1);
        return String(inserted.id);
      });
    },

    promote: async (queue, limit) => {
      ctx.writable();
      return sqlGuard(async () => sqlJobPromote(ctx, buffer, queue, limit));
    },
    take: async (queue, worker, request) => {
      ctx.writable();
      return sqlGuard(async () => sqlJobTake(ctx, buffer, queue, worker, request));
    },
    heartbeat: async (attempts, worker, leaseMs) => {
      ctx.writable();
      return sqlGuard(async () => sqlJobHeartbeat(ctx, attempts, worker, leaseMs));
    },
    complete: async (attempt, worker, outcome) => {
      ctx.writable();
      return sqlGuard(async () => sqlJobComplete(ctx, buffer, attempt, worker, outcome));
    },
    stats: async (queue) => sqlGuard(async () => sqlJobStats(ctx, queue)),

    cancel: async (queue, key) => {
      ctx.writable();
      const cancelled = await sqlGuard(async () => sqlJobCancel(ctx, buffer, { queue, key }));
      return cancelled.length;
    },
  };
}
