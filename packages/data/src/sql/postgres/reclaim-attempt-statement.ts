import { lostLeaseLimit } from '../../lost-lease-limit.ts';
import { jobKeyLockSql } from '../job-key-lock-sql.ts';
import type { PostgresStatement } from './begin-unit-statements.ts';
import { jobGroupScopeSql } from './job-group-scope.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * The first step of the reclaim of a take (9.5.4): finds the running jobs of a queue whose lease
 * ended before `now` and locks, without waiting, everything their reclaim will write. Whatever it
 * cannot lock at once, because another unit holds it, it leaves, and the job is not `ready`: a later
 * take reclaims it. Every lock is `skip locked` or tried. PostgreSQL decides the order in which the
 * CTEs run; what the statement fixes is what each CTE reads, so a job's other rows are locked only
 * after its job row, and a head's key is tried only after that head's `done`, group and `enqueued`
 * rows, which the CTE of the try reads. What each CTE locks:
 * - the lane rows (`for no key update`, the mode the take's pick uses) of the jobs that return to
 *   `available`, for their `taken`;
 * - the `done` counter rows of the lanes of the jobs that die, and the group rows of the jobs that
 *   have a group, for their running slot;
 * - the `enqueued` counter rows of the lanes of the dying FIFO heads whose `done` and group rows it
 *   got, for the follower a head's end makes available;
 * - the advisory lock of each such head's key, by a try (`pg_try_advisory_xact_lock`, written once per
 *   lane and key in the select list of a materialized CTE, never as a filter, so the planner cannot
 *   run a try for a row that another condition rejects). A key is tried only for a head whose `done`,
 *   group and lane `enqueued` rows it got, so a key is held only when everything else of its head is. A job that
 *   returns to `available` stays the key's head and takes no key lock.
 *
 * A job dies at its third consecutive lost lease, except an action job whose run carries a command id
 * (`mayHoldReceipt`): that stays `available` whatever the count, and its taker ends it with its
 * receipt. The statement answers one row per expired job it locked: its lane, key and group, `dies`,
 * `head` (a dying FIFO head: it dies, orders by key and has a key), whether the job is `ready` (it and
 * every row of its reclaim are held, and for a head its key too) and `group_missing`, a group row that
 * does not exist (`skip locked` cannot tell a held row from a missing one, so the group rows are also
 * read without a lock). The unit holds every lock until it ends, also for a job that is not ready,
 * except a key, which it holds only for a ready head; none of them can make a take wait.
 */
export function reclaimAttemptStatement(
  rootName: string,
  queue: string,
  now: string,
  scopeId: string | null,
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  const wantedGroup = `exists (
    select 1 from expired e where e.group_id = g.id and e.group_scope_id is not distinct from g.scope_id)`;
  const groupHeld = (alias: string): string =>
    `(${alias}.group_id is null or exists (
    select 1 from groups g where g.id = ${alias}.group_id and g.scope_id is not distinct from ${alias}.group_scope_id))`;
  return {
    sql: `with locked as materialized (
  select j.id, j.lane_id, j.ordering, j.key, j.group_id, ${jobGroupScopeSql('j')} as group_scope_id,
    (j.lost_leases + 1 >= ${lostLeaseLimit}
      and not (j.kind = 'action' and coalesce(jsonb_typeof(j.input -> 'commandId') = 'string', false))) as dies
  from ${root}.kw_jobs j
  where j.queue = $1::text and j.state = 'running' and j.lease_until < $2::timestamptz
    and ($3::uuid is null or j.scope_id = $3::uuid)
  order by j.id for update skip locked
), expired as materialized (
  select l.id, l.lane_id, l.key, l.group_id, l.group_scope_id, l.dies,
    (l.dies and l.ordering = 'fifo-per-key' and l.key is not null) as head
  from locked l
), lanes as materialized (
  select l.id from ${root}.kw_job_lanes l
  where l.id in (select lane_id from expired where not dies)
  order by l.id for no key update skip locked
), done as materialized (
  select c.lane_id from ${root}.kw_job_lane_counts c
  where c.kind = 'done' and c.lane_id in (select lane_id from expired where dies)
  order by c.lane_id for update skip locked
), present_groups as materialized (
  select g.id, g.scope_id from ${root}.kw_job_groups g where ${wantedGroup}
), groups as materialized (
  select g.id, g.scope_id from ${root}.kw_job_groups g where ${wantedGroup}
  order by g.id, g.scope_id nulls first for update skip locked
), heads as materialized (
  select distinct e.lane_id, e.key from expired e
  where e.head and e.lane_id in (select lane_id from done) and ${groupHeld('e')}
), counts as materialized (
  select c.lane_id from ${root}.kw_job_lane_counts c
  where c.kind = 'enqueued' and c.lane_id in (select lane_id from heads)
  order by c.lane_id for update skip locked
), tried as materialized (
  select h.lane_id, h.key, pg_try_advisory_xact_lock(${jobKeyLockSql('$4', 'h.lane_id', 'h.key')}) as got
  from heads h where h.lane_id in (select lane_id from counts)
)
select e.id::text as id, e.lane_id::text as lane_id, e.key, e.group_id, e.dies, e.head,
  (e.group_id is not null and not exists (
    select 1 from present_groups g where g.id = e.group_id and g.scope_id is not distinct from e.group_scope_id)) as group_missing,
  (case when e.dies then e.lane_id in (select lane_id from done) else e.lane_id in (select lane_id from lanes) end
    and ${groupHeld('e')}
    and (not e.head or exists (
      select 1 from tried t where t.lane_id = e.lane_id and t.key = e.key and t.got))) as ready
from expired e order by e.id`,
    parameters: [queue, now, scopeId, rootName],
  };
}
