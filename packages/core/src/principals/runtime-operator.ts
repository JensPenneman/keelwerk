import type { OperatorPrincipal } from './operator-principal.ts';

/**
 * The principal of the control commands the runtime issues itself (S-75): an operator of its own,
 * because the core's rules allow operators on the control entities and deny the system principal
 * (section 8.8). It never travels over a transport; only code in the process can build it.
 */
export const runtimeOperator: OperatorPrincipal = {
  kind: 'operator',
  id: 'core.runtime',
  scope: { backend: null, tenant: null },
  claims: {},
  roles: [],
  memberships: [],
  via: 'core.runtime',
  ref: { resolver: 'core.runtime', principalId: 'core.runtime' },
};
