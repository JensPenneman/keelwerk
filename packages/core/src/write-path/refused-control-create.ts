import type { Principal } from '../principals/principal.ts';
import { runtimeOperator } from '../principals/runtime-operator.ts';

/**
 * The generated `create` of a `core.tenant` or `core.backend` by anyone but the runtime's own
 * operator: those rows are made by `Runtime.control` (`createTenant`, `createBackend`), which
 * checks the catalogue, the placement and the API version and runs the hooks. Returns the control
 * operation to use, or `undefined` when the create is allowed.
 */
export function refusedControlCreate(
  module: string,
  entity: string | undefined,
  kind: string | undefined,
  principal: Principal,
): string | undefined {
  if (module !== 'core' || kind !== 'create' || entity === undefined) return undefined;
  const ref = entity.includes('.') ? entity : `core.${entity}`;
  if (ref !== 'core.tenant' && ref !== 'core.backend') return undefined;
  if (principal.kind === 'operator' && principal.via === runtimeOperator.via) return undefined;
  return ref === 'core.tenant' ? 'control.createTenant' : 'control.createBackend';
}
