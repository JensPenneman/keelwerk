import type { PrincipalContext, PrincipalKind } from '@keelwerk/core';
import type { MemberRole } from './member-roles.ts';
import { membershipKind } from './membership-kind.ts';

/**
 * True when a membership of this module gives the principal one of `roles`. It reads the
 * principal's `memberships`, never `roles`: roles are a convenience another enricher or a test
 * principal may fill (docs/architecture.md, 8.5).
 */
export function hasRole<const Pk extends PrincipalKind>(
  ctx: PrincipalContext<Pk>,
  ...roles: readonly MemberRole[]
): boolean {
  const { memberships } = ctx.principal;
  return memberships.some(
    (membership) =>
      membership.kind === membershipKind && (roles as readonly string[]).includes(membership.role),
  );
}
