import type { StorageScope, UsageCharge } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { checkUsageUnit } from './check-usage-unit.ts';

/**
 * The charge `UsageStore.giveBack` buffers: the counter lowered by `amount`, with no limit, so the
 * tail never refuses it. A namespace unit, an amount below 0 and a dimension of the framework
 * (`core.`, that is `core.eventBytes` and `core.rows`) are `internal`: the adapter alone lowers
 * `core.eventBytes`, in the unit that removes the records, and nothing lowers `core.rows`; nothing
 * above the adapter may lower either.
 */
export function usageGiveBackCharges(
  scope: StorageScope,
  dimension: string,
  amount: bigint,
): readonly UsageCharge[] {
  checkUsageUnit(scope);
  if (amount < 0n) throw errors.internal('an amount given back cannot be below 0');
  if (dimension.startsWith('core.')) {
    throw errors.internal(
      `the counter ${dimension} of the framework is lowered by the adapter only`,
    );
  }
  return amount === 0n ? [] : [{ dimension, delta: -amount, limit: null }];
}
