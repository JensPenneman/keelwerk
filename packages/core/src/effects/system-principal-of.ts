import type { Principal } from '../principals/principal.ts';
import type { SystemPrincipal } from '../principals/system-principal.ts';

/** The system principal of `invoke(..., { as: system(reason) })`: no roles or claims, the scope of the principal it replaces. */
export function systemPrincipalOf(reason: string, replaced: Principal): SystemPrincipal {
  return {
    kind: 'system',
    reason,
    scope: replaced.scope,
    claims: {},
    roles: [],
    memberships: [],
    via: 'core.system',
    ref: null,
  };
}
