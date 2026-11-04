import type { ModuleEntry } from '../registry/module-entry.ts';
import type { Registry } from '../registry/registry.ts';

/**
 * The modules a part of `module` may name in `ctx.load` (section 8.4): itself, the modules it
 * requires, the targets of its active contributions and the modules their `when` lists name, and
 * the optional ones behind the Maybe accessor.
 */
export function visibleModules(registry: Registry, module: ModuleEntry): ReadonlySet<string> {
  const visible = new Set<string>([module.id, ...module.requires, ...module.optional]);
  for (const contribution of registry.contributions) {
    if (contribution.from !== module.id || !contribution.active) continue;
    visible.add(contribution.to);
    for (const id of contribution.when) visible.add(id);
  }
  return visible;
}
