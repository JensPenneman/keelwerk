import type { StoredEvent, Unit } from '@keelwerk/core';
import type { SpikeWorld } from './start-spike-world.ts';

/** The events of one stream, read in one unit. */
export function eventsOf(
  world: SpikeWorld,
  type: string,
  id: string,
): Promise<readonly StoredEvent[]> {
  return world.runtime.adapter.unit(world.namespace, world.scope, (unit: Unit) =>
    unit.events.readStream({ type, id }),
  );
}
