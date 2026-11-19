import { coreErrorCodes, KeelwerkError, RetryableUnitError, uniqueConflict } from '@keelwerk/core';
import { isConnectionFailure } from './is-connection-failure.ts';

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const { code } = error;
  return typeof code === 'string' ? code : undefined;
}

function constraintOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) return undefined;
  const { constraint } = error;
  return typeof constraint === 'string' ? constraint : undefined;
}

/**
 * Maps a driver error to the contract's errors (S-54): a unique violation (23505) is `conflict`, a
 * serialization failure (40001) and a deadlock (40P01) are the kernel-internal
 * `RetryableUnitError`, and a statement over the unit's `statement_timeout` (57014) is `unavailable`
 * `core.timeout` (section 10). A connection that was lost or could not be opened is `unavailable`
 * `core.unavailable`, retryable. Anything else is returned as it is.
 */
export function mapPostgresError(error: unknown): unknown {
  switch (codeOf(error)) {
    case '23505':
      return uniqueConflict(constraintOf(error), error);
    case '23503':
      return new KeelwerkError({
        ...coreErrorCodes['core.reference_missing'],
        code: 'core.reference_missing',
        cause: error,
      });
    case '40001':
      return new RetryableUnitError('serialization_failure', { cause: error });
    case '40P01':
      return new RetryableUnitError('deadlock', { cause: error });
    case '57014':
      return new KeelwerkError({
        ...coreErrorCodes['core.timeout'],
        code: 'core.timeout',
        cause: error,
      });
    default:
      if (!isConnectionFailure(error)) return error;
      return new KeelwerkError({
        ...coreErrorCodes['core.unavailable'],
        code: 'core.unavailable',
        message:
          error instanceof Error && error.message === 'timeout exceeded when trying to connect'
            ? 'No database connection became free in time: every connection of the pool is in use.'
            : 'The database is unreachable: the connection was lost or could not be opened.',
        cause: error,
      });
  }
}
