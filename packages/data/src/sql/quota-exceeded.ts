import { coreErrorCodes, KeelwerkError } from '@keelwerk/core';

/** The refusal of a unit whose charge ends above its limit: not retryable, the counter named. */
export function quotaExceeded(dimension: string, limit: bigint, value: bigint): KeelwerkError {
  return new KeelwerkError({
    ...coreErrorCodes['core.quota_exceeded'],
    code: 'core.quota_exceeded',
    details: { dimension, limit: Number(limit), value: Number(value) },
  });
}
