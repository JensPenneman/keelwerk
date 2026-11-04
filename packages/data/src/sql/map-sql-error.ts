import { errors, RetryableUnitError } from '@keelwerk/core';

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const { code } = error;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Maps the SQLSTATE of a failed statement to the contract's errors, the same way on PGlite and on
 * `pg` (S-54): a unique violation is `conflict`, a serialization failure and a deadlock are the
 * kernel-internal `RetryableUnitError`. Anything else is returned as it is.
 */
export function mapSqlError(error: unknown): unknown {
  switch (codeOf(error)) {
    case '23505':
      return errors.conflict('A unique value is already taken.', { cause: error });
    case '40001':
      return new RetryableUnitError('serialization_failure', { cause: error });
    case '40P01':
      return new RetryableUnitError('deadlock', { cause: error });
    default:
      return error;
  }
}
