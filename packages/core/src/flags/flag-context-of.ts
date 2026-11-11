import type { FlagLevel } from '../dsl/define-flag.ts';
import type { Principal } from '../principals/principal.ts';
import type { Scope } from '../storage/scope.ts';
import { principalIdOf } from '../tokens/principal-id-of.ts';
import type { FlagContext } from './flag-context.ts';

function targetingKeyOf(
  level: FlagLevel,
  scope: Scope,
  id: string | null,
  principal: Principal,
  clientId: string | null,
): string | null {
  if (level === 'deployment') return null;
  if (level === 'backend') return scope.level === 'deployment' ? null : scope.backendId;
  if (level === 'tenant') return scope.level === 'tenant' ? scope.tenantId : null;
  return id ?? (principal.kind === 'anonymous' ? clientId : null);
}

/**
 * The FlagContext of one flag level: targetingKey deployment null, backend backendId, tenant
 * tenantId, principal principalIdOf(principal), else the client id for an anonymous principal.
 */
export function flagContextOf(
  level: FlagLevel,
  targeting: {
    readonly scope: Scope;
    readonly principal: Principal;
    readonly clientId: string | null;
  },
): FlagContext {
  const { scope, principal, clientId } = targeting;
  const id = principalIdOf(principal);
  return {
    scope,
    principal: { kind: principal.kind, id, roles: principal.roles },
    attributes: {},
    targetingKey: targetingKeyOf(level, scope, id, principal, clientId),
  };
}
