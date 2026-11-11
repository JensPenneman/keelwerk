import { crossScopeGroup } from '../effects/cross-scope-group.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { Connected } from './connected.ts';

/**
 * Provisions a backend's cross-scope group (`crossScopeGroup`) in a namespace unit, once per process
 * and backend: a tenant's unit may only read a namespace group, so the group exists before the
 * first command of the backend's tenants can enqueue a job for the backend's unit. A placement this
 * process did not open is skipped, and a failed provisioning is forgotten, so the next lookup tries again.
 */
export function provisionBackendGroup(
  connected: Pick<Connected, 'placements'>,
): (backend: {
  readonly backendId: string;
  readonly placementId: string;
  readonly namespace: NamespaceRef;
}) => Promise<void> {
  const known = new Map<string, Promise<void>>();
  return (backend) => {
    const key = `${backend.namespace.id}/${backend.backendId}`;
    const found = known.get(key);
    if (found !== undefined) return found;
    const handle = connected.placements.get(backend.placementId);
    // A placement this process did not open runs no unit here: nothing to provision or to use.
    if (handle === undefined) return Promise.resolve();
    const done = handle.adapter
      .unit(backend.namespace, { level: 'namespace', reason: 'cross-scope group' }, (unit) =>
        unit.jobs.provisionGroup(crossScopeGroup(backend.backendId)),
      )
      .catch((error: unknown) => {
        known.delete(key);
        throw error;
      });
    known.set(key, done);
    return done;
  };
}
