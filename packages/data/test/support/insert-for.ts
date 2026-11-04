import { ns } from './ns.ts';
import { seeds } from './seeds.ts';

/** An insert into `table` for the scope in `scope`; job tables attach to `lane`. */
export function insertFor(
  table: string,
  scope: string,
  lane: string,
): { text: string; values: unknown[] } {
  if (table === 'kw_jobs') {
    return {
      text: `insert into ${ns}.kw_jobs (scope_id, scope, lane_id, queue, kind, state, principal, causation, build_id, revision, input, created_at)
        values ($1, jsonb_build_object('level', 'tenant', 'tenantId', $1::uuid::text), $2, 'q', 'action', 'available', '{}', '{}', 'b', 1, '{}', now())`,
      values: [scope, lane],
    };
  }
  if (table === 'kw_job_lane_counts') {
    return {
      text: `insert into ${ns}.kw_job_lane_counts (lane_id, kind, scope_id, value) values ($2, 'enqueued', $1, 0)`,
      values: [scope, lane],
    };
  }
  const found = seeds.find(([name]) => name === table);
  if (found === undefined) throw new Error(`no seed for ${table}`);
  return { text: found[1], values: [scope] };
}
