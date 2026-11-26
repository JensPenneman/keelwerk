import type { InvocationSession } from '@keelwerk/core';

/**
 * Whether a renewal holds the credentials the checked session held: same kind, same subject, same
 * stored reference, same scope.
 */
export function holdsSameCredentials(held: InvocationSession, renewed: InvocationSession): boolean {
  const [a, b] = [held.principal, renewed.principal];
  if (a.kind !== b.kind) return false;
  if (a.kind === 'user' && b.kind === 'user' && a.subject !== b.subject) return false;
  if (a.ref?.resolver !== b.ref?.resolver || a.ref?.principalId !== b.ref?.principalId) {
    return false;
  }
  return (
    a.scope.tenant === b.scope.tenant &&
    a.scope.backend === b.scope.backend &&
    held.scope.level === renewed.scope.level &&
    ('tenantId' in held.scope ? held.scope.tenantId : null) ===
      ('tenantId' in renewed.scope ? renewed.scope.tenantId : null) &&
    ('backendId' in held.scope ? held.scope.backendId : null) ===
      ('backendId' in renewed.scope ? renewed.scope.backendId : null)
  );
}
