import type { StorageScope, UsageCharge } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { checkUsageUnit } from './check-usage-unit.ts';

/**
 * The charges `UsageStore.charge` buffers: the caller's own, which only grow a counter or declare a
 * limit. A namespace unit and a delta below 0 are `internal`; the adapter lowers a counter
 * through `usageGiveBackCharges` or its own removals.
 */
export function usageStoreCharges(
  scope: StorageScope,
  charges: readonly UsageCharge[],
): readonly UsageCharge[] {
  checkUsageUnit(scope);
  for (const charge of charges) {
    if (charge.delta < 0n) {
      throw errors.internal('a charge cannot lower a counter: give the amount back');
    }
  }
  return charges;
}
