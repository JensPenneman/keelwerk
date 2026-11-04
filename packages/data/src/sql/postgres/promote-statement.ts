import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/** What the promotion needs: the namespace root, the queue, how many jobs at most and the unit's clock. */
export interface PromoteInput {
  readonly root: string;
  readonly queue: string;
  readonly limit: number;
  /** The instant jobs are due at or before, an ISO timestamp. */
  readonly now: string;
  /** The unit's scope id; null in a namespace-scope unit, which reaches every scope. */
  readonly scopeId: string | null;
}

/**
 * Promotion (9.5.2): the oldest due `scheduled` jobs of the queue, at most `limit`, become
 * `available`. The rows are locked with `skip locked`, so two fetchers never promote one job
 * twice. The statement answers one row per lane that gained jobs, with the number: the caller moves
 * each lane's `enqueued` counter at the commit tail, beside the unit's other changes.
 */
export function promoteStatement(input: PromoteInput): PostgresStatement {
  const root = quoteIdentifier(input.root);
  return {
    sql: `with due as (
  select id from ${root}.kw_jobs
  where queue = $1::text and state = 'scheduled' and run_at <= $2::timestamptz
    and ($4::uuid is null or scope_id = $4::uuid)
  order by run_at, id limit $3::integer for update skip locked
), moved as (
  update ${root}.kw_jobs j set state = 'available' from due where j.id = due.id returning j.lane_id
)
select lane_id::text as lane_id, count(*)::text as n from moved group by lane_id order by lane_id`,
    parameters: [input.queue, input.now, String(input.limit), input.scopeId],
  };
}
