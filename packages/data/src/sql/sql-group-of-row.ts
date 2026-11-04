import { decodeInstant } from './decode-instant.ts';
import { parseGroupRate } from './parse-group-rate.ts';
import type { SqlRow } from './run-sql.ts';
import type { SqlGroupState } from './sql-group-state.ts';

/** A locked `kw_job_groups` row as the group check reads it. */
export function sqlGroupOfRow(row: SqlRow): SqlGroupState {
  const rate = row.rate === null ? null : parseGroupRate(String(row.rate));
  return {
    id: String(row.id),
    scopeId: row.scope_id === null ? null : String(row.scope_id),
    concurrency: row.concurrency === null ? null : Number(row.concurrency),
    running: Number(row.running),
    rate,
    tokens: row.tokens === null ? 0 : Number(row.tokens),
    refilledAt: row.refilled_at === null ? null : decodeInstant(row.refilled_at),
    blockedUntil: row.blocked_until === null ? null : decodeInstant(row.blocked_until),
  };
}
