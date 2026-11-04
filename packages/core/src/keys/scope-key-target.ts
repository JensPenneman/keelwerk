import { errors } from '../errors/errors.ts';
import type { StorageScope } from '../storage/storage-scope.ts';

/** Which scope key a storage scope uses: the tenant's, the backend's or the deployment's. */
export function scopeKeyTarget(
  scope: StorageScope,
  deploymentId: string,
): { readonly level: 'deployment' | 'backend' | 'tenant'; readonly scopeId: string } {
  switch (scope.level) {
    case 'tenant':
      return { level: 'tenant', scopeId: scope.tenantId };
    case 'backend':
      return { level: 'backend', scopeId: scope.backendId };
    case 'deployment':
      return { level: 'deployment', scopeId: deploymentId };
    case 'namespace':
      throw errors.internal('The kernel-internal namespace scope has no key.');
  }
}
