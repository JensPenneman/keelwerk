import type { Registry } from '../registry/registry.ts';
import type { EntityBehaviours } from './entity-behaviours.ts';

/** The behaviours the registry records on its entities, by entity reference. */
export function registryBehaviours(registry: Registry): EntityBehaviours {
  return (entity) => registry.entities.get(entity)?.behaviour;
}
