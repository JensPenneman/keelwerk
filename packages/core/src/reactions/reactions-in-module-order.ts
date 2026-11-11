import type { ReactionEntry } from '../registry/reaction-entry.ts';
import type { Registry } from '../registry/registry.ts';

/** The reactions of one timing in module order: by the module's place in the topological order, then by id. */
export function reactionsInModuleOrder(
  registry: Registry,
  timing: 'inline' | 'async',
): readonly ReactionEntry[] {
  const order = new Map(registry.modules.map((module) => [module.id, module.order] as const));
  return [...registry.reactions.values()]
    .filter((reaction) => reaction.timing === timing)
    .sort(
      (a, b) => (order.get(a.module) ?? 0) - (order.get(b.module) ?? 0) || a.id.localeCompare(b.id),
    );
}
