import type { KeelwerkError } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { quoteIdentifier } from './postgres/quote-identifier.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/** The error of a lane row or counter row that a settle did not find: row-level security hides it from the unit, or it is missing. */
export function laneCounterHidden(ctx: SqlUnitContext): KeelwerkError {
  return errors.internal(
    `a lane counter row is missing or hidden from the unit (${quoteIdentifier(ctx.namespace.root)})`,
  );
}
