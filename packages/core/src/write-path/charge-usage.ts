import type { Unit } from '../storage/unit.ts';
import type { UsageCharge } from '../storage/usage-charge.ts';

/** Hands a command's charges to its unit's commit tail; nothing when there are none. */
export function chargeUsage(unit: Unit, charges: readonly UsageCharge[]): void {
  if (charges.length > 0) unit.usage.charge(charges);
}
