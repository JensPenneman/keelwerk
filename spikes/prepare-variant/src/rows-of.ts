import type { StorageRow, Unit } from '@keelwerk/core';
import type { SpikeWorld } from './start-spike-world.ts';

/** The rows of an entity, read in one unit. */
export function rowsOf(world: SpikeWorld, entity: string): Promise<readonly StorageRow[]> {
  const entry = world.registry.entities.get(entity);
  if (entry === undefined) throw new Error(`the spike app has no ${entity}`);
  return world.runtime.adapter.unit(
    world.namespace,
    world.scope,
    async (unit: Unit) => (await unit.rows.find(entry.descriptor, {})).rows,
  );
}
