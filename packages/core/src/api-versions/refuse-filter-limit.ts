import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { FilterLimitError } from '../wire/filter-limit-error.ts';

/**
 * Runs a walk over a filter and turns the refusal of its bounds (`FilterLimitError`: too many
 * levels or members) into the `validation` error `core.malformed_request`, whose issue holds the
 * path of the level that went over. Anything else passes through.
 */
export function refuseFilterLimit<T>(walk: () => T): T {
  try {
    return walk();
  } catch (failure) {
    if (!(failure instanceof FilterLimitError)) throw failure;
    throw new KeelwerkError({
      kind: 'validation',
      code: 'core.malformed_request',
      message: failure.message,
      issues: [{ path: failure.path, message: failure.reason }],
    });
  }
}
