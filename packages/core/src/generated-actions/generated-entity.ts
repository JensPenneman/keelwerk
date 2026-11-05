import { errors } from '../errors/errors.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Registry } from '../registry/registry.ts';

/** The entity a generated action belongs to. */
export function generatedEntity(registry: Registry, action: ActionEntry): EntityEntry {
  const entry = action.entity === undefined ? undefined : registry.entities.get(action.entity);
  if (entry === undefined) {
    throw errors.internal(`the generated action "${action.ref}" names no entity of this app`);
  }
  return entry;
}
