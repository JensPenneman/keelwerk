import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { ControlLeaseStore } from './control-lease-store.ts';
import { leasesOf } from './leases-of.ts';

/**
 * `ControlStore.writeLeases`: one writing deployment-scope unit of the control namespace for all the
 * calls `fn` makes, so what it holds in it commits together and a second `hold` of one (kind, key)
 * keeps the lock of the first until the commit.
 */
export function createLeaseUnit(
  adapter: DataAdapter,
  namespace: NamespaceRef,
): <T>(fn: (leases: ControlLeaseStore) => Promise<T>) => Promise<T> {
  return (fn) => adapter.unit(namespace, { level: 'deployment' }, (unit) => fn(leasesOf(unit)));
}
