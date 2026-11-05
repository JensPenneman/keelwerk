import type { Scope } from '../storage/scope.ts';

/**
 * The id the scope has in the receipt store: tenant id, backend id, or the deployment id (S-69)
 * for the deployment scope, which the mount learns from `MountContext.deploymentId`.
 */
export function receiptScopeId(scope: Scope, deploymentId: string): string {
  switch (scope.level) {
    case 'tenant':
      return scope.tenantId;
    case 'backend':
      return scope.backendId;
    case 'deployment':
      return deploymentId;
  }
}
