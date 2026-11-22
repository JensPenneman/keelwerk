import { laneCounterHidden } from './lane-counter-hidden.ts';
import { settleTakenStatement } from './postgres/settle-taken-statement.ts';
import { runSql } from './run-sql.ts';
import type { SqlLaneChanges } from './sql-lane-changes.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/** Writes the `taken` counts of lane changes, each lane's row locked in ascending lane id; the checks are those of `sqlSettleDone`. */
export async function sqlSettleTaken(ctx: SqlUnitContext, changes: SqlLaneChanges): Promise<void> {
  const lanes = changes.entries().filter((lane) => lane.taken !== 0);
  if (lanes.length === 0) return;
  const [row] = await runSql(ctx.db, settleTakenStatement(ctx.namespace.root, lanes));
  if (row === undefined || Number(row.taken) !== lanes.length) throw laneCounterHidden(ctx);
}
