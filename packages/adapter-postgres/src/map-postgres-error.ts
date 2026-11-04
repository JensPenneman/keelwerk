import { coreErrorCodes, errors, KeelwerkError, RetryableUnitError } from '@keelwerk/core';

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const { code } = error;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Maps a driver error to the contract's errors (S-54): a unique violation (23505) is `conflict`, a
 * serialization failure (40001) and a deadlock (40P01) are the kernel-internal
 * `RetryableUnitError`, and a statement over the unit's `statement_timeout` (57014) is `unavailable`
 * `core.timeout` (section 10). Anything else is returned as it is.
 */
export function mapPostgresError(error: unknown): unknown {
  switch (codeOf(error)) {
    case '23505':
      return errors.conflict('A unique value is already taken.', { cause: error });
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
      return error;
  }
}
