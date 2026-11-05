import type { ReactionEntry } from '../registry/reaction-entry.ts';
import type { Registry } from '../registry/registry.ts';

/** Inline reactions in module order: by the module's place in the topological order, then by id. */
export function inlineReactionsOf(registry: Registry): readonly ReactionEntry[] {
  const order = new Map(registry.modules.map((module) => [module.id, module.order] as const));
  return [...registry.reactions.values()]
    .filter((reaction) => reaction.timing === 'inline')
    .sort(
      (a, b) => (order.get(a.module) ?? 0) - (order.get(b.module) ?? 0) || a.id.localeCompare(b.id),
    );
}
