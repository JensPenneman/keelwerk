import { errors } from '../errors/errors.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { Unit } from '../storage/unit.ts';
import type { ControlLeaseStore } from './control-lease-store.ts';

function leasesOf(unit: Unit): NonNullable<Unit['leases']> {
  if (unit.leases === undefined)
    throw errors.unsupported('The control adapter has no lease store.');
  return unit.leases;
}

/**
 * `ControlStore.leases`: every call runs in its own deployment-scope unit of the control namespace,
 * a writing one for `hold`, `release` and `expire`, a read-only one for `total`. A unit without
 * `leases` is `unsupported` ("The control adapter has no lease store.").
 */
export function createControlLeases(
  adapter: DataAdapter,
  namespace: NamespaceRef,
): ControlLeaseStore {
  return {
    hold: (lease, ttlMs) =>
      adapter.unit(namespace, { level: 'deployment' }, (unit) => leasesOf(unit).hold(lease, ttlMs)),
    release: (kind, key, holder) =>
      adapter.unit(namespace, { level: 'deployment' }, (unit) =>
        leasesOf(unit).release(kind, key, holder),
      ),
    total: (kind, key) =>
      adapter.unit(namespace, { level: 'deployment' }, (unit) => leasesOf(unit).total(kind, key), {
        readOnly: true,
      }),
    expire: (kind, limit) =>
      adapter.unit(namespace, { level: 'deployment' }, (unit) =>
        leasesOf(unit).expire(kind, limit),
      ),
  };
}
