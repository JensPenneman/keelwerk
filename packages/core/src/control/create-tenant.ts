import type { ControlStore } from './control-store.ts';
import { runControlCommand } from './run-control-command.ts';

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
 * Creates a tenant row through the write path, the programmatic form of the generated
 * `core.tenant.create` until the generated actions are served (S-26): the unit that writes the
 * tenant also writes its domain rows (inline reaction), and a host name another tenant holds fails
 * it with `conflict`.
 */
export async function createTenant(
  store: ControlStore,
  input: TenantInput,
): Promise<{ readonly id: string }> {
  let id = '';
  await runControlCommand(store, 'tenant.create', (ctx) => {
    const draft = ctx.write.core.tenant.create({
      backendId: input.backendId as never,
      name: input.name,
      domains: [...(input.domains ?? [])],
      ...(input.placement === undefined ? {} : { placement: input.placement }),
      ...(input.apiVersion === undefined ? {} : { apiVersion: input.apiVersion }),
    });
    id = draft.id;
    return [draft];
  });
  return { id };
}
