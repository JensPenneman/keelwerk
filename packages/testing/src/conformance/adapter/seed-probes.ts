import type { Unit } from '@keelwerk/core';
import { conformanceEntities } from '@keelwerk/data/conformance';
import { probeOwners } from './probe-owners.ts';
import { probeRows } from './probe-rows.ts';

/** Inserts the owners and the probes into the unit's scope. */
export async function seedProbes(unit: Unit): Promise<void> {
  await unit.rows.insert(conformanceEntities.owner, probeOwners);
  await unit.rows.insert(conformanceEntities.probe, probeRows);
}
