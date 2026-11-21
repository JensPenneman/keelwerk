import { coreErrorCodes } from '../errors/core-error-codes.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';

/**
 * The refusal of a command whose storage counter stands or ends above its limit: not retryable, the
 * counter named. A storage limit is checked in one place for the command a unit is opened for, and
 * what runs nested in that unit follows that command (12.2). The admission refuses a command with
 * `prepare` that starts while any counter is above its limit, whatever its decision would store,
 * unless its id has a finished, unexpired receipt or an effect record already (`admitPrepare`); the
 * commit tail of the unit opened for such a command declares no storage limit
 * (`isUnitExemptFromTail`), so it refuses nothing that unit stores, a synchronous command nested in
 * it included. The commit tail refuses the unit of a command without `prepare`, a job of one
 * included, when it ends above a limit in a dimension the unit adds to; a synchronous command
 * nested there declares the limit too. An action of the core module is exempt at both places. Both
 * build the error here.
 */
export function quotaExceeded(dimension: string, limit: bigint, value: bigint): KeelwerkError {
  return new KeelwerkError({
    ...coreErrorCodes['core.quota_exceeded'],
    code: 'core.quota_exceeded',
    details: { dimension, limit: Number(limit), value: Number(value) },
  });
}
