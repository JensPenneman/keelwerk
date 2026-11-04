import type { JobOutcome } from '@keelwerk/core';
import { encodeInstant } from '../encode-instant.ts';
import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

const returned = `id, scope_id, lane_id, queue, kind, attempt, started_at, ordering, key, group_id, group_spec ->> 'scope' as group_scope`;

/** What a completion needs: the fencing pair, the outcome and the unit's clock. */
export interface CompleteJobInput {
  readonly root: string;
  readonly jobId: string;
  readonly attempt: number;
  readonly worker: string;
  readonly outcome: JobOutcome;
  /** An ISO timestamp. */
  readonly now: string;
  /** The unit's scope id; a namespace-scope unit passes null and reaches every scope. */
  readonly scopeId: string | null;
}

/**
 * The completion statement of a job's unit (9.5.2), conditional on the job running for this worker
 * and attempt: success and a failure without a dead-letter target delete the row, a dead letter
 * keeps it in state `dead` with its input, a retry sets it back to `scheduled` at the given time with
 * its lost leases cleared. All but the retry write the history row (outcome, attempts, timings
 * and error, never the input; a dead letter replayed and finished again replaces its row). The
 * statement answers the job's lane, key and group, or nothing when the lease was lost.
 */
export function completeJobStatement(input: CompleteJobInput): PostgresStatement {
  const root = quoteIdentifier(input.root);
  const { outcome } = input;
  const parameters: unknown[] = [input.jobId, String(input.attempt), input.worker];
  const bind = (value: unknown, cast: string): string => {
    parameters.push(value);
    return `$${parameters.length}::${cast}`;
  };
  const fenced = `id = $1::bigint and attempt = $2::integer and worker = $3 and state = 'running'${
    input.scopeId === null ? '' : ` and scope_id = ${bind(input.scopeId, 'uuid')}`
  }`;
  const change = (() => {
    switch (outcome.kind) {
      case 'succeeded':
      case 'failed':
        return `delete from ${root}.kw_jobs where ${fenced} returning ${returned}`;
      case 'dead':
        return `update ${root}.kw_jobs set state = 'dead', worker = null, lease_until = null where ${fenced} returning ${returned}`;
      case 'retry':
        return `update ${root}.kw_jobs set state = 'scheduled', run_at = ${bind(encodeInstant(outcome.at), 'timestamptz')}, worker = null, lease_until = null, lost_leases = 0
where ${fenced} returning ${returned}`;
    }
  })();
  const history =
    outcome.kind === 'retry'
      ? ''
      : `, history as (
  insert into ${root}.kw_job_history (scope_id, job_id, queue, kind, outcome, attempts, started_at, finished_at, error)
  select scope_id, id, queue, kind, ${bind(outcome.kind, 'text')}, attempt, started_at, ${bind(input.now, 'timestamptz')},
    ${bind(outcome.kind === 'succeeded' ? null : JSON.stringify(outcome.error), 'jsonb')} from done
  on conflict (scope_id, job_id) do update set outcome = excluded.outcome, attempts = excluded.attempts,
    started_at = excluded.started_at, finished_at = excluded.finished_at, error = excluded.error
)`;
  return {
    sql: `with done as (
  ${change}
)${history}
select id::text as id, scope_id::text as scope_id, lane_id::text as lane_id, ordering, key, group_id, group_scope from done`,
    parameters,
  };
}
