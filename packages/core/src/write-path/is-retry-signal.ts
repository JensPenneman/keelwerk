import { isUniqueConflict } from '../errors/is-unique-conflict.ts';
import { isRetryableUnitError } from './is-retryable-unit-error.ts';

/** Whether `error` is the kernel's own signal to repeat a unit: what `retryUnit` repeats, and a unique-index violation. The invoke map never maps it. */
export function isRetrySignal(error: unknown): boolean {
  return isRetryableUnitError(error) || isUniqueConflict(error);
}
