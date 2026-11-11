import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * Claims one tick of a schedule in one scope (S-118): the row moves to its next tick only while it
 * still holds the expected one, and answers the schedule id then. A concurrent claim waits on the
 * row lock and then matches nothing, so exactly one caller per tick and scope gets a row back.
 */
export function claimTickStatement(
  rootName: string,
  scopeId: string,
  scheduleId: string,
  expected: string,
  next: string,
  updatedAt: string,
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `update ${root}.kw_schedules set last_tick = $3::timestamptz, next_tick = $4::timestamptz, updated_at = $5::timestamptz
where scope_id = $1::uuid and schedule_id = $2::text and next_tick = $3::timestamptz
returning schedule_id`,
    parameters: [scopeId, scheduleId, expected, next, updatedAt],
  };
}
