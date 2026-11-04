import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/** What the fair take needs (section 9.5.3). */
export interface FairTakeInput {
  readonly root: string;
  readonly queue: string;
  /** The capability sets this process satisfies. */
  readonly capabilitySets: readonly string[];
  /** `$vmin`, read in the take's unit by `takeBoundsStatement`. */
  readonly vmin: number;
  /** How many lanes to lock at most. */
  readonly lanes: number;
  /** The batch size, shared over the lanes picked. */
  readonly batch: number;
  /** Only jobs enqueued by a build at or below this revision. */
  readonly maxRevision: number;
  /** The unit's clock, an ISO timestamp: a group blocked beyond it holds its jobs back. */
  readonly now: string;
  /** The unit's scope id; null in a namespace-scope unit, which reaches every scope. */
  readonly scopeId: string | null;
}

/**
 * The fair take of 9.5.3, locking lane rows and then job rows with `skip locked`. Two readings
 * differ from the printed statement and neither changes what PostgreSQL 18 accepts: the load per
 * share divides as `double precision` (the printed `bigint / integer` truncates, which ties a lane
 * with three running jobs of weight 2 to one with two), and a lane that was picked but had no job
 * to hand out still answers one row with a null job, so the caller can tell lanes it locked from
 * lanes it skipped. A job whose group is blocked stays behind; the group's concurrency and rate are
 * checked under the group's row lock after the pick (14.3.9). The rows come back in the order of
 * the pick (class, load per weight, virtual time, lane) and then due order, so the caller's cut at its
 * batch size serves the lanes the pick ranked first; the ranking is projected from `picked` as
 * plain columns because PostgreSQL refuses window functions together with `for update`. Columns are text where a driver would
 * otherwise choose a type for them.
 */
export function fairTakeStatement(input: FairTakeInput): PostgresStatement {
  const root = quoteIdentifier(input.root);
  return {
    sql: `with picked as (
  select l.id, l.priority, l.capability_set, l.cap, l.cap - (l.taken - d.value) as room,
    (l.taken - d.value)::double precision / l.weight as load, greatest(l.vtime, $3::double precision) as v from ${root}.kw_job_lanes l
  join ${root}.kw_job_lane_counts e on e.lane_id = l.id and e.kind = 'enqueued'
  join ${root}.kw_job_lane_counts d on d.lane_id = l.id and d.kind = 'done'
  where l.queue = $1::text and l.capability_set = any ($2::text[]) and e.value > l.taken and l.taken - d.value < l.cap
    and ($8::uuid is null or l.scope_id = $8::uuid)
  order by l.priority, (l.taken - d.value)::double precision / l.weight, greatest(l.vtime, $3::double precision), l.id
  limit $4::integer
  for update of l skip locked
), share as (select greatest(1, ceil($5::numeric / nullif(count(*), 0))) as n from picked)
select p.id::text as lane_id, p.priority, p.capability_set, p.cap,
  j.id::text as id, j.scope_id::text as scope_id, j.scope, j.queue, j.kind, j.run_at, j.principal, j.causation,
  j.build_id, j.revision, j.api_version, j.ordering, j.group_id, j.group_spec, j.key, j.cost, j.retry,
  j.heartbeat_seconds, j.expire_in_seconds, j.dead_letter, j.input, j.attempt, j.created_at
from picked p cross join share s left join lateral (
  select * from ${root}.kw_jobs j
  where j.lane_id = p.id and j.state = 'available' and j.revision <= $6::integer
    and not exists (
      select 1 from ${root}.kw_job_groups g
      where g.id = j.group_id
        and g.scope_id is not distinct from (case when j.group_spec ->> 'scope' = 'namespace' then null else j.scope_id end)
        and g.blocked_until > $7::timestamptz)
  order by j.run_at, j.id
  limit least(p.room, s.n)
  for update skip locked) j on true
order by p.priority, p.load, p.v, p.id, j.run_at, j.id`,
    parameters: [
      input.queue,
      input.capabilitySets,
      input.vmin,
      String(input.lanes),
      String(input.batch),
      String(input.maxRevision),
      input.now,
      input.scopeId,
    ],
  };
}
