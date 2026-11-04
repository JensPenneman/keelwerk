import type { StorageScope } from '@keelwerk/core';

/** The id the scope's positions are kept under (`kw_positions.scope_id`); a namespace scope has none. */
export function unitScopeId(scope: StorageScope, deploymentId: string): string | undefined {
  switch (scope.level) {
    case 'tenant':
      return scope.tenantId;
    case 'backend':
      return scope.backendId;
    case 'deployment':
      return deploymentId;
    case 'namespace':
      return undefined;
  }
}
