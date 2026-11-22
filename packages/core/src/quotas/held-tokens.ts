/** The tokens a process holds of one bucket, and when it took them. */
export interface Held {
  tokens: number;
  takenAt: Temporal.Instant;
}

/**
 * The entries a process holds, kept by scope so that an entry is dropped from a scope only while
 * that scope holds at least as many entries as every other scope.
 */
export interface HeldTokens {
  get(scope: string, name: string): Held | undefined;
  /** Makes the entry the most recently used of its scope; above `most` entries drops one. */
  remember(scope: string, name: string, entry: Held): void;
  /** How many scopes hold at least one entry: a scope whose last entry was dropped is forgotten. */
  scopesHeld(): number;
}

/**
 * The entries of a process's allowance, at most `most` in all. Above that, the entry dropped is the
 * least recently used entry of the scope that holds the most entries, so an entry is dropped from a
 * scope only while that scope holds at least as many entries as every other scope. A scope that
 * adds entries faster than it uses them (an anonymous caller that changes address with every
 * request) therefore drops its own entries once it holds the most, and before that cuts another
 * scope only while that scope holds at least as many entries as the flooding scope (so to at most
 * one fewer), then drops its own. Every operation takes constant time, however many scopes and
 * entries are held: an entry is looked up by its scope and name, each scope keeps its entries in
 * the order of their last use (a `Map` iterates in insertion order), and the scopes are grouped by
 * the number of entries they hold, so the largest group is at hand when an entry has to go. A
 * scope's count changes by one at a time, so the size of the largest group falls by at most one
 * when a scope leaves it.
 */
export function createHeldTokens(most: number): HeldTokens {
  const scopes = new Map<string, Map<string, Held>>();
  const bySize = new Map<number, Set<string>>();
  let largest = 0;
  let total = 0;
  const regroup = (scope: string, from: number, to: number): void => {
    if (from > 0) {
      const group = bySize.get(from);
      group?.delete(scope);
      if (group?.size === 0) bySize.delete(from);
    }
    if (to > 0) {
      const group = bySize.get(to) ?? new Set<string>();
      group.add(scope);
      bySize.set(to, group);
    }
    if (to > largest) largest = to;
    while (largest > 0 && !bySize.has(largest)) largest -= 1;
  };
  const dropOldest = (): void => {
    const scope = bySize.get(largest)?.values().next().value;
    const entries = scope === undefined ? undefined : scopes.get(scope);
    const oldest = entries?.keys().next().value;
    if (scope === undefined || entries === undefined || oldest === undefined) return;
    entries.delete(oldest);
    total -= 1;
    regroup(scope, entries.size + 1, entries.size);
    if (entries.size === 0) scopes.delete(scope);
  };
  return {
    get: (scope, name) => scopes.get(scope)?.get(name),
    scopesHeld: () => scopes.size,
    remember: (scope, name, entry) => {
      const entries = scopes.get(scope) ?? new Map<string, Held>();
      const before = entries.size;
      entries.delete(name);
      entries.set(name, entry);
      scopes.set(scope, entries);
      if (entries.size !== before) {
        total += 1;
        regroup(scope, before, entries.size);
      }
      while (total > most) {
        const held = total;
        dropOldest();
        if (total === held) break;
      }
    },
  };
}
