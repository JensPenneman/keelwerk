import type { ModuleEntry } from '../registry/module-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { buildEntityLoads } from './build-entity-loads.ts';
import type { RequestAuthorities } from './request-authorities.ts';

type Loads = Readonly<Record<string, unknown>>;

/** `ctx.load.<module>`: the loads of each entity the module owns. */
export function buildModuleLoads(
  registry: Registry,
  module: ModuleEntry,
  authority: string,
  authorities: RequestAuthorities,
): Loads {
  const loads: Record<string, unknown> = {};
  for (const reference of module.entities) {
    const entity = registry.entities.get(reference);
    if (entity !== undefined)
      loads[entity.name] = buildEntityLoads(entity, 'module', authority, authorities);
  }
  return Object.freeze(loads);
}
