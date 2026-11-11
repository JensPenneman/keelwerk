import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * The rows of `kw_schedules` whose next tick is at or before `now`, oldest tick first (ties by scope
 * and schedule id, both in binary order), at most `limit`; with a scope id only the rows of that
 * scope; with `after` only the rows that sort strictly after that key.
 */
export function dueSchedulesStatement(
  rootName: string,
  now: string,
  limit: number,
  scopeId: string | null,
  after: {
    readonly nextTick: string;
    readonly scopeId: string;
    readonly scheduleId: string;
  } | null,
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  const parameters = [now, String(limit)];
  let where = 'next_tick <= $1::timestamptz';
  if (scopeId !== null) {
    parameters.push(scopeId);
    where += ` and scope_id = $${parameters.length}::uuid`;
  }
  if (after !== null) {
    const tick = parameters.length + 1;
    const scope = tick + 1;
    const schedule = tick + 2;
    parameters.push(after.nextTick, after.scopeId, after.scheduleId);
    where += ` and (next_tick > $${tick}::timestamptz
  or (next_tick = $${tick}::timestamptz and (scope_id::text collate "C" > $${scope}::text collate "C"
    or (scope_id::text collate "C" = $${scope}::text collate "C" and schedule_id collate "C" > $${schedule}::text collate "C"))))`;
  }
  return {
    sql: `select schedule_id, scope_id::text as scope_id, last_tick, next_tick from ${root}.kw_schedules
where ${where}
order by next_tick, scope_id::text collate "C", schedule_id collate "C"
limit $2::integer`,
    parameters,
  };
}
