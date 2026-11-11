import type { EventSelector, Registry } from '@keelwerk/core';

/**
 * The events the dispatcher reads (7.7, S-136): every event when an async reaction of any app
 * observes `all`, else the sorted union of the event references the async reactions listen to
 * (an empty list matches nothing, so a deployment without async reactions reads no event).
 */
export function dispatcherSelector(registries: Iterable<Registry>): EventSelector {
  const names = new Set<string>();
  for (const registry of registries) {
    for (const reaction of registry.reactions.values()) {
      if (reaction.timing !== 'async') continue;
      if (reaction.on === 'all') return {};
      for (const type of reaction.on) names.add(type);
    }
  }
  return { names: [...names].sort() };
}
