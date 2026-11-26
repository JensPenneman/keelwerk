import type { PrincipalContext, PrincipalKind } from '@keelwerk/core';

/**
 * True when the principal holds a membership of the members module with the role admin or owner in
 * the tenant the context runs in. The kind is the members module's own (`membershipKind`, which the
 * kernel takes only from that module's fills); `roles` decides nothing, for any module can add a role.
 */
export function isTenantAdmin<Pk extends PrincipalKind>(ctx: PrincipalContext<Pk>): boolean {
  return (
    ctx.scope.level === 'tenant' &&
    ctx.principal.scope.tenant === ctx.scope.tenantId &&
    ctx.principal.memberships.some(
      (membership) =>
        membership.kind === 'members.membership' &&
        (membership.role === 'admin' || membership.role === 'owner'),
    )
  );
}
