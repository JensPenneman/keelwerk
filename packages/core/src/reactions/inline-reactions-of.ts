import type { ReactionEntry } from '../registry/reaction-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { reactionsInModuleOrder } from './reactions-in-module-order.ts';

/** Inline reactions in module order: by the module's place in the topological order, then by id. */
export function inlineReactionsOf(registry: Registry): readonly ReactionEntry[] {
  return reactionsInModuleOrder(registry, 'inline');
}
