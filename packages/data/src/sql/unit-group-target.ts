import { runSql } from './run-sql.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';
import type { JobGroupTarget } from './upsert-job-group.ts';

/** The target of a unit's transaction. */
export function unitGroupTarget(ctx: SqlUnitContext): JobGroupTarget {
  return {
    root: ctx.namespace.root,
    now: ctx.clock.now(),
    run: async (sql, parameters) => {
      await runSql(ctx.db, { sql, parameters });
    },
  };
}
