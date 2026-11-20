import type { PrincipalContext, PrincipalKind } from '@keelwerk/core';

/** True when the principal holds the role admin or owner in the tenant the context runs in. */
export function isTenantAdmin<Pk extends PrincipalKind>(ctx: PrincipalContext<Pk>): boolean {
  return (
    ctx.scope.level === 'tenant' &&
    ctx.principal.scope.tenant === ctx.scope.tenantId &&
    (ctx.principal.roles.includes('admin') || ctx.principal.roles.includes('owner'))
  );
}
