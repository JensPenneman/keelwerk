import { isControlCommand } from '../core-module/is-control-command.ts';

/**
 * The explicit `core.backend.create` and `core.tenant.create` outside the control path: those
 * rows are made by the runtime's control path (`Runtime.control`, the operator socket), which
 * checks the catalogue, the placement and the API version and runs the hooks. Returns the control
 * operation to use, or `undefined` when the command is no control command or comes by that path.
 */
export function refusedControlCommand(
  ref: string,
  controlPath: boolean | undefined,
): string | undefined {
  if (controlPath === true || !isControlCommand(ref)) return undefined;
  return ref === 'core.tenant.create' ? 'control.createTenant' : 'control.createBackend';
}
