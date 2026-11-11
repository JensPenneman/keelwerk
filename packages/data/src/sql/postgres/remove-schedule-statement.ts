import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * Deletes the row of one schedule in one scope (S-118) and answers its schedule id; no row back
 * means there was none. A namespace unit may delete any scope's row (the `maintenance` policy).
 */
export function removeScheduleStatement(
  rootName: string,
  scopeId: string,
  scheduleId: string,
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `delete from ${root}.kw_schedules where scope_id = $1::uuid and schedule_id = $2::text
returning schedule_id`,
    parameters: [scopeId, scheduleId],
  };
}
