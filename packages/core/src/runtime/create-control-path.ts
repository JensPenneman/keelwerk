import type { ControlRun } from '../control/control-run.ts';
import type { BackendInput } from '../control/create-backend.ts';
import { createBackend } from '../control/create-backend.ts';
import type { TenantInput } from '../control/create-tenant.ts';
import { createTenant } from '../control/create-tenant.ts';
import { runTenantHooks } from '../control/run-tenant-hooks.ts';
import { errors } from '../errors/errors.ts';
import { moduleConfigOf } from '../invoker/module-config-of.ts';
import { moduleConfigShapes } from '../invoker/module-config-shapes.ts';
import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { Connected } from './connected.ts';
import type { ControlPath } from './control-path.ts';
import type { DeploymentDefinition } from './deployment-definition.ts';
import type { Migrated } from './migrate-phase.ts';
import type { ServedApp } from './served-app.ts';

/**
 * The runtime's control path (S-26, S-27, S-109): validates against the catalogue, writes through
 * `core.backend.create` or `core.tenant.create` in the control store, makes the scope resolve at
 * once and runs the hooks, unless the command id replayed an earlier create. A command id whose
 * receipt exists skips the checks and the sealing: the write path replays it, answers
 * `core.command_in_progress` or `core.idempotency_mismatch`.
 */
export function createControlPath(input: {
  readonly deployment: DeploymentDefinition;
  readonly served: readonly ServedApp[];
  readonly connected: Connected;
  readonly migrated: Migrated;
}): ControlPath {
  const { deployment, served, connected, migrated } = input;
  const { control } = connected;
  const lookup = migrated.directory.lookup;
  const placementHosts = (name: string, app: string): void => {
    const placement = deployment.placements[name];
    if (placement === undefined || !Object.hasOwn(deployment.placements, name)) {
      throw errors.validation(`The deployment has no placement "${name}".`);
    }
    if (Array.isArray(placement.apps) && !(placement.apps as readonly string[]).includes(app)) {
      throw errors.validation(`Placement "${name}" does not host app "${app}".`);
    }
  };
  const versionKnown = (app: ServedApp, version: string | undefined): void => {
    const versions = app.source.api?.dates;
    if (version !== undefined && versions !== undefined && !versions.includes(version)) {
      throw errors.validation(`"${version}" is not an API version of "${app.id}".`);
    }
  };
  const configOf = (
    app: ServedApp,
    stored: Readonly<Record<string, unknown>> | undefined,
  ): ((module: string) => unknown) =>
    moduleConfigOf(moduleConfigShapes(app.source.modules), stored);
  /** Whether the command id already has a live receipt: the write path then decides replay, progress or mismatch. */
  const received = async (who: ControlRun): Promise<boolean> => {
    if (who.commandId === undefined) return false;
    const id = who.commandId;
    const receipt = await control.read((unit) => unit.receipts.get(id));
    return (
      receipt !== undefined && Temporal.Instant.compare(receipt.expiresAt, control.clock.now()) > 0
    );
  };
  return {
    createBackend: async (backend: BackendInput, who: ControlRun) => {
      const replay = await received(who);
      const app = served.find((candidate) => candidate.id === backend.app);
      if (!replay) {
        if (app === undefined) {
          throw errors.validation(
            `The deployment's catalogue (this process) has no app "${backend.app}".`,
          );
        }
        placementHosts(backend.placement, app.id);
        versionKnown(app, backend.apiVersion);
      }
      const created = await createBackend(control, backend, who, {
        modules: app?.source.modules ?? [],
        replay,
      });
      migrated.directory.invalidate();
      if (created.replayed) return created;
      const record = await lookup.backend(created.id);
      const handle = connected.placements.get(backend.placement);
      if (record === undefined || handle === undefined || app === undefined) {
        throw errors.internal('A backend was created but does not resolve.');
      }
      const target: ScopeTarget = {
        scope: { level: 'backend', backendId: created.id },
        namespace: record.namespace,
        handle,
      };
      await runTenantHooks({
        store: control,
        registry: app.registry,
        hook: 'onBackendCreated',
        payload: { id: created.id as never, name: backend.name },
        target,
        head: app.head,
        config: configOf(app, record.config),
      });
      return created;
    },
    createTenant: async (tenant: TenantInput, who: ControlRun) => {
      const replay = await received(who);
      const backend = await lookup.backend(tenant.backendId);
      const app = served.find((candidate) => candidate.id === backend?.app);
      if (!replay) {
        if (backend === undefined) {
          throw errors.not_found(`The backend ${tenant.backendId} does not exist.`);
        }
        if (app === undefined) {
          throw errors.unavailable(`App "${backend.app}" is not served by this process.`);
        }
        if (backend.status === 'suspended') {
          throw errors.validation(
            `The backend ${backend.id} is suspended; no tenant can be created.`,
          );
        }
        if (tenant.placement !== undefined) placementHosts(tenant.placement, app.id);
        versionKnown(app, tenant.apiVersion);
      }
      const created = await createTenant(control, tenant, who, { replay });
      migrated.directory.invalidate();
      if (created.replayed) return created;
      const record = await lookup.tenant(created.id);
      const handle = connected.placements.get(record?.placementId ?? backend?.placementId ?? '');
      if (
        record === undefined ||
        handle === undefined ||
        backend === undefined ||
        app === undefined
      ) {
        throw errors.internal('A tenant was created but does not resolve.');
      }
      await runTenantHooks({
        store: control,
        registry: app.registry,
        hook: 'onTenantCreated',
        payload: { id: created.id as never, name: tenant.name },
        target: {
          scope: { level: 'tenant', backendId: backend.id, tenantId: created.id },
          namespace: record.namespace,
          handle,
        },
        head: app.head,
        config: configOf(app, backend.config),
      });
      return created;
    },
  };
}
