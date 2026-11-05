import type { ControlRun } from '../control/control-run.ts';
import type { BackendInput } from '../control/create-backend.ts';
import type { TenantInput } from '../control/create-tenant.ts';

/** What a control create answers: the new row's id, and whether the command id replayed an earlier create. */
interface ControlCreated {
  readonly id: string;
  readonly replayed: boolean;
}

/**
 * The runtime's path for the explicit control commands (S-109): the catalogue, placement and
 * version checks, the write, the directory refresh and the hooks, for any principal and any
 * command id. The command runner routes `core.backend.create` and `core.tenant.create` to it,
 * and `Runtime.control` calls it as the runtime's own operator.
 */
export interface ControlPath {
  createBackend(input: BackendInput, who: ControlRun): Promise<ControlCreated>;
  createTenant(input: TenantInput, who: ControlRun): Promise<ControlCreated>;
}
