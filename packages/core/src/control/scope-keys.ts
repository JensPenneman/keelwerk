import { errors } from '../errors/errors.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { ScopeKeyStore } from '../storage/scope-key-store.ts';

/**
 * `withScopeKeys` of the key service (S-55): runs `fn` in a deployment-scope unit of the control
 * store that commits when `fn` returns.
 */
export function withScopeKeys(
  adapter: DataAdapter,
  namespace: NamespaceRef,
): <T>(fn: (keys: ScopeKeyStore) => Promise<T>) => Promise<T> {
  return (fn) =>
    adapter.unit(namespace, { level: 'deployment' }, (unit) => {
      if (unit.scopeKeys === undefined) {
        throw errors.unsupported('The control adapter has no scope key store.');
      }
      return fn(unit.scopeKeys);
    });
}
