import type { KeelwerkError } from '@keelwerk/core';
import { errors } from '@keelwerk/core';

/**
 * The error of a member whose work package has not wired it into the adapter yet. The units, the
 * schema operations and the change feed arrive with the stores that serve them; until then the
 * adapter offers the unit session (`session`) and nothing pretends to run.
 */
export function postgresNotWired(member: string): KeelwerkError {
  return errors.unsupported(`${member} of the postgres adapter is not available yet`);
}
