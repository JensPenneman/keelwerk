import { errors } from '../errors/errors.ts';
import type { ScopeKeyStore } from '../storage/scope-key-store.ts';
import type { WrappedScopeKey } from '../storage/wrapped-scope-key.ts';

/**
 * A `withScopeKeys` that reads the real store and keeps every key added through it in memory, so
 * a key the caller creates is never committed (the dry run, 11 and 13.6). The added keys live as
 * long as the returned function.
 */
export function overlayScopeKeys(
  real: <T>(fn: (keys: ScopeKeyStore) => Promise<T>) => Promise<T>,
): <T>(fn: (keys: ScopeKeyStore) => Promise<T>) => Promise<T> {
  const added = new Map<string, WrappedScopeKey>();
  return (fn) =>
    real((store) =>
      fn({
        current: async (scopeId) => (await store.current(scopeId)) ?? added.get(scopeId),
        byVersion: async (scopeId, version) => {
          const held = added.get(scopeId);
          return (
            (await store.byVersion(scopeId, version)) ??
            (held?.version === version ? held : undefined)
          );
        },
        add: async (key) => {
          added.set(key.scopeId, key);
        },
        retire: async () => {
          throw errors.internal('A dry run does not retire scope keys.');
        },
        destroy: async () => {
          throw errors.internal('A dry run does not destroy scope keys.');
        },
      }),
    );
}
