import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * Inserts the row of a schedule in one scope (S-118). An existing row keeps everything but its next
 * tick, which becomes the earlier of the stored one and the new one: a second process that seeds the
 * same grid moves nothing, and a schedule whose period got shorter does not wait for the old grid.
 * The period is part of a tick's id, so builds rolling in beside each other never share a tick.
 */
export function upsertScheduleStatement(
  rootName: string,
  scopeId: string,
  scheduleId: string,
  nextTick: string,
  updatedAt: string,
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  return {
    sql: `insert into ${root}.kw_schedules (scope_id, schedule_id, last_tick, next_tick, updated_at)
values ($1::uuid, $2::text, null, $3::timestamptz, $4::timestamptz)
on conflict (scope_id, schedule_id) do update set next_tick = least(${root}.kw_schedules.next_tick, excluded.next_tick)
where excluded.next_tick < ${root}.kw_schedules.next_tick`,
    parameters: [scopeId, scheduleId, nextTick, updatedAt],
  };
}
