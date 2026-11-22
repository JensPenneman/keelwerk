import type { AdapterCapabilities } from '@keelwerk/core';
import type { PlacementFacts } from './deployment-facts.ts';
import type { Fact } from './fact.ts';
import type { PlacementSlot } from './placement-slots-of.ts';

/** One placement as the checks see it: its name, adapter and apps from the slot, and what its adapter does natively. */
export function placementFactsOf(
  slot: PlacementSlot,
  capabilities: Fact<AdapterCapabilities>,
): PlacementFacts {
  return { name: slot.name, adapter: slot.entry.adapter, apps: slot.apps, capabilities };
}
