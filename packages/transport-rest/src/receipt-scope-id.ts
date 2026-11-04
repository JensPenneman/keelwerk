import type { Scope } from '@keelwerk/core';

/**
 * The id the scope has in the receipt store: tenant id, backend id, or `deployment` for the
 * deployment scope (the transport does not know the deployment id of a SQL backend).
 */
export function receiptScopeId(scope: Scope): string {
  switch (scope.level) {
    case 'tenant':
      return scope.tenantId;
    case 'backend':
      return scope.backendId;
    case 'deployment':
      return 'deployment';
  }
}
