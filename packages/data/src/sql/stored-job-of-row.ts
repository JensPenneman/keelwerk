import type { Scope, StoredJob } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { decodeInstant } from './decode-instant.ts';
import { jobPriorityName } from './job-priority-name.ts';
import type { SqlRow } from './run-sql.ts';

/** A `jsonb` value as the driver returns it: parsed, or still text. */
function jsonOf(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

/**
 * The job's scope, which must name the unit `scope_id` stands for: row-level security keys on
 * `scope_id`, while the taker runs the job in the unit `scope` names.
 */
function scopeOf(value: unknown, id: string): Scope {
  const scope = jsonOf(value);
  if (typeof scope !== 'object' || scope === null || !('level' in scope)) {
    throw errors.internal(`the job of scope ${id} has no scope; it was not written by enqueue`);
  }
  const named =
    scope.level === 'tenant' && 'tenantId' in scope
      ? scope.tenantId
      : scope.level === 'backend' && 'backendId' in scope
        ? scope.backendId
        : id;
  if (named !== id) {
    throw errors.internal(`the job of scope ${id} names the scope ${String(named)}`);
  }
  return scope as Scope;
}

/**
 * A job the fair take picked, as a `StoredJob` with the attempt the worker now holds (14.3.9).
 * The lane gives the priority class, the capability set and the cap; `onConflict` of a key acts at
 * enqueue only and is not stored (9.5.2), so a taken job's key says `keep`.
 */
export function storedJobOfRow(row: SqlRow): StoredJob {
  const id = String(row.id);
  const attempt = Number(row.attempt) + 1;
  const capability = String(row.capability_set);
  return {
    id,
    runAt: decodeInstant(row.run_at),
    attempt: { jobId: id, attempt },
    queue: String(row.queue),
    run: jsonOf(row.input) as StoredJob['run'],
    scope: scopeOf(row.scope, String(row.scope_id)),
    principal: jsonOf(row.principal) as StoredJob['principal'],
    causation: jsonOf(row.causation) as StoredJob['causation'],
    build: { id: String(row.build_id), revision: Number(row.revision) },
    kind: row.kind === 'effect' ? 'effect' : 'action',
    laneCap: Number(row.cap),
    createdAt: decodeInstant(row.created_at),
    priority: jobPriorityName(Number(row.priority)),
    cost: Number(row.cost),
    heartbeatSeconds: Number(row.heartbeat_seconds),
    ...(row.api_version === null ? {} : { apiVersion: String(row.api_version) }),
    ...(row.key === null ? {} : { key: { value: String(row.key), onConflict: 'keep' as const } }),
    ...(row.ordering === 'fifo-per-key' ? { ordering: 'fifo-per-key' as const } : {}),
    ...(row.group_spec === null
      ? {}
      : { group: jsonOf(row.group_spec) as NonNullable<StoredJob['group']> }),
    ...(capability === '' ? {} : { capability: capability.split(',') }),
    ...(row.retry === null ? {} : { retry: jsonOf(row.retry) as NonNullable<StoredJob['retry']> }),
    ...(row.expire_in_seconds === null ? {} : { expireInSeconds: Number(row.expire_in_seconds) }),
    ...(row.dead_letter === null ? {} : { deadLetter: String(row.dead_letter) }),
  };
}
