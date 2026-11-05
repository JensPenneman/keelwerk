import type { ControlRun } from './control-run.ts';
import type { ControlStore } from './control-store.ts';
import { runControlCreate } from './run-control-create.ts';

/** The values of a new `core.tenant` row (S-26). */
export interface TenantInput {
  readonly backendId: string;
  readonly name: string;
  /** A placement name of the deployment; default the backend's. */
  readonly placement?: string;
  readonly apiVersion?: string;
  /** Host names; `core.syncDomains` keeps one `core.domain` row for each. */
  readonly domains?: readonly string[];
}

/**
 * Creates a tenant row through `core.tenant.create` (S-26, S-109): the unit that writes the
 * tenant also writes its domain rows (inline reaction), and a host name another tenant holds fails
 * it with `conflict`.
 */
export async function createTenant(
  store: ControlStore,
  input: TenantInput,
  who: ControlRun,
  options: { readonly replay?: boolean } = {},
): Promise<{ readonly id: string; readonly replayed: boolean }> {
  const values = {
    backendId: input.backendId,
    name: input.name,
    ...(input.domains === undefined ? {} : { domains: [...input.domains] }),
    ...(input.placement === undefined ? {} : { placement: input.placement }),
    ...(input.apiVersion === undefined ? {} : { apiVersion: input.apiVersion }),
  };
  return runControlCreate(
    store,
    'tenant',
    { values, fingerprintInput: values, ...(options.replay === true ? { replayOnly: true } : {}) },
    who,
  );
}
