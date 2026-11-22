import type { AdapterCapabilities, DeploymentDefinition } from '@keelwerk/core';
import { couldNotOpen } from '../../src/doctor/could-not-open.ts';
import type { PlacementFacts } from '../../src/doctor/deployment-facts.ts';
import type { Fact } from '../../src/doctor/fact.ts';
import { placementFactsOf } from '../../src/doctor/placement-facts-of.ts';
import { placementSlotsOf } from '../../src/doctor/placement-slots-of.ts';

/**
 * The placements of a deployment as production lists them (the control store first, each with
 * the apps it hosts, from the same walk), with the capabilities a case gives by name. A placement
 * the case does not name is one doctor could not open; a name that is no placement throws.
 */
export function placementsOf(
  definition: DeploymentDefinition,
  capabilities: Readonly<Record<string, Fact<AdapterCapabilities>>> = {},
): readonly PlacementFacts[] {
  const slots = placementSlotsOf(definition);
  for (const name of Object.keys(capabilities)) {
    if (!slots.some((slot) => slot.name === name)) {
      throw new Error(`the case names capabilities for ${name}, which is no placement`);
    }
  }
  return slots.map((slot) =>
    placementFactsOf(slot, capabilities[slot.name] ?? couldNotOpen('the case opens nothing')),
  );
}
