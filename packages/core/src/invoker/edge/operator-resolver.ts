import type { OperatorPrincipal } from '../../principals/operator-principal.ts';
import type { Carrier } from '../carrier.ts';

/**
 * The kernel's own principal resolver (section 3.5): a carrier from the operator socket or from
 * the process itself is operator access, because only code that holds the socket or runs in
 * the process can build one. Returns undefined for every other carrier.
 */
export function operatorResolver(carrier: Carrier): OperatorPrincipal | undefined {
  const { local } = carrier;
  if (local === undefined) return undefined;
  const id = 'socket' in local ? 'local.socket' : 'local.in-process';
  return {
    kind: 'operator',
    id,
    scope: { backend: null, tenant: null },
    claims: {},
    roles: [],
    memberships: [],
    via: 'core.operator',
    ref: { resolver: 'core.operator', principalId: id },
  };
}
