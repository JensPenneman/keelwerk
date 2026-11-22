import { laneCounterHidden } from './lane-counter-hidden.ts';
import { settleDoneStatement } from './postgres/settle-done-statement.ts';
import { runSql } from './run-sql.ts';
import type { SqlLaneChanges } from './sql-lane-changes.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * Writes the `done` counters of lane changes, each lane's counter row locked in ascending lane id.
 * A lane the unit's row-level security hides is updated zero times without an error, so the number
 * of lanes moved is checked. Each settle takes its counters before its groups' rows
 * (`sqlReleaseGroups`); the lane rows (`sqlSettleTaken`, `sqlWriteLaneLimits`) come after all settles.
 */
export async function sqlSettleDone(ctx: SqlUnitContext, changes: SqlLaneChanges): Promise<void> {
  const lanes = changes.entries().filter((lane) => lane.done !== 0);
  if (lanes.length === 0) return;
  const [row] = await runSql(ctx.db, settleDoneStatement(ctx.namespace.root, lanes));
  if (row === undefined || Number(row.counted) !== lanes.length) throw laneCounterHidden(ctx);
}
