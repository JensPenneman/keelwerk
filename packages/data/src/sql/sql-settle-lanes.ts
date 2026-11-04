import { errors } from '@keelwerk/core';
import { quoteIdentifier } from './postgres/quote-identifier.ts';
import { settleLanesStatement } from './postgres/settle-lanes-statement.ts';
import { runSql } from './run-sql.ts';
import type { SqlLaneChanges } from './sql-lane-changes.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * Writes lane changes: `done` counters and `taken`, each lane's rows locked in ascending lane id.
 * A lane the unit's row-level security hides is updated zero times without an error, so the number
 * of lanes moved is checked.
 */
export async function sqlSettleLanes(ctx: SqlUnitContext, changes: SqlLaneChanges): Promise<void> {
  if (changes.size === 0) return;
  const lanes = changes.entries();
  const [row] = await runSql(ctx.db, settleLanesStatement(ctx.namespace.root, lanes));
  const expectedTaken = lanes.filter((lane) => lane.taken !== 0).length;
  if (
    row === undefined ||
    Number(row.counted) !== lanes.length ||
    Number(row.taken) !== expectedTaken
  ) {
    throw errors.internal(
      `a lane counter row is missing or hidden from the unit (${quoteIdentifier(ctx.namespace.root)})`,
    );
  }
}
