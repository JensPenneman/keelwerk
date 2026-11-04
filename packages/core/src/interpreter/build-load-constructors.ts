import { camelFromKebab } from '../naming/camel-from-kebab.ts';
import type { ModuleEntry } from '../registry/module-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { buildMaybeAccessor } from './build-maybe-accessor.ts';
import { buildModuleLoads } from './build-module-loads.ts';
import type { RequestAuthorities } from './request-authorities.ts';
import { visibleModules } from './visible-modules.ts';

type Loads = Readonly<Record<string, unknown>>;

/**
 * The modules a part of `module` may name in `ctx.load` (section 8.4): itself, the modules it
 * requires, the targets of its contributions and the modules their `when` lists name, and the
 * optional ones behind the Maybe accessor.
 */
export function buildLoadConstructors(
  registry: Registry,
  module: ModuleEntry,
  authorities: RequestAuthorities,
): Loads {
  const find = (id: string): ModuleEntry | undefined =>
    registry.modules.find((entry) => entry.id === id);
  const loads: Record<string, unknown> = {};
  for (const id of visibleModules(registry, module)) {
    if (module.optional.includes(id)) continue;
    const found = find(id);
    if (found !== undefined)
      loads[found.contextName] = buildModuleLoads(registry, found, module.id, authorities);
  }
  for (const id of module.optional) {
    const found = find(id);
    loads[found?.contextName ?? camelFromKebab(id)] = buildMaybeAccessor(
      id,
      found !== undefined,
      () => (found === undefined ? {} : buildModuleLoads(registry, found, module.id, authorities)),
      module.id,
      authorities,
    );
  }
  return Object.freeze(loads);
}
