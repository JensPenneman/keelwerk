import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/** The counters of a group row after a take or a completion; times are ISO timestamps. */
export interface GroupCounters {
  readonly id: string;
  readonly scopeId: string | null;
  readonly running: number;
  readonly tokens: number | null;
  readonly refilledAt: string | null;
  readonly blockedUntil: string | null;
}

/** Writes the counters of a group row the caller holds the lock of. */
export function writeGroupStatement(rootName: string, group: GroupCounters): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `update ${root}.kw_job_groups set running = $3::integer, tokens = $4::double precision,
  refilled_at = $5::timestamptz, blocked_until = $6::timestamptz
where id = $1 and scope_id is not distinct from $2::uuid`,
    parameters: [
      group.id,
      group.scopeId,
      String(group.running),
      group.tokens === null ? null : String(group.tokens),
      group.refilledAt,
      group.blockedUntil,
    ],
  };
}
