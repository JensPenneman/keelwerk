import type { Anchoring } from '../anchors/start-anchoring.ts';
import { createBackend } from '../control/create-backend.ts';
import { createTenant } from '../control/create-tenant.ts';
import { findControlRows } from '../control/find-control-rows.ts';
import { runTenantHooks } from '../control/run-tenant-hooks.ts';
import { errors } from '../errors/errors.ts';
import { moduleConfigOf } from '../invoker/module-config-of.ts';
import { moduleConfigShapes } from '../invoker/module-config-shapes.ts';
import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { Connected } from './connected.ts';
import type { DeploymentDefinition } from './deployment-definition.ts';
import type { Migrated } from './migrate-phase.ts';
import type { RuntimeControl } from './runtime-control.ts';
import type { ServedApp } from './served-app.ts';

/** `Runtime.control` over the control store: validates against the catalogue, writes, makes the scope resolve at once, runs the hooks (S-26, S-27). */
export function createRuntimeControl(input: {
  readonly deployment: DeploymentDefinition;
  readonly served: readonly ServedApp[];
  readonly connected: Connected;
  readonly migrated: Migrated;
  readonly anchoring?: Anchoring;
}): RuntimeControl {
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
  return {
    anchorSinks: () => input.anchoring?.sinkStatus?.() ?? [],
    createBackend: async (backend) => {
      const app = served.find((candidate) => candidate.id === backend.app);
      if (app === undefined) {
        throw errors.validation(
          `The deployment's catalogue (this process) has no app "${backend.app}".`,
        );
      }
      placementHosts(backend.placement, app.id);
      versionKnown(app, backend.apiVersion);
      const created = await createBackend(control, backend, app.source.modules);
      migrated.directory.invalidate();
      const record = await lookup.backend(created.id);
      const handle = connected.placements.get(backend.placement);
      if (record === undefined || handle === undefined) {
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
    createTenant: async (tenant) => {
      const backend = await lookup.backend(tenant.backendId);
      if (backend === undefined)
        throw errors.not_found(`The backend ${tenant.backendId} does not exist.`);
      const app = served.find((candidate) => candidate.id === backend.app);
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
      const created = await createTenant(control, tenant);
      migrated.directory.invalidate();
      const record = await lookup.tenant(created.id);
      const handle = connected.placements.get(record?.placementId ?? backend.placementId);
      if (record === undefined || handle === undefined) {
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
    rerunTenantHooks: async (tenantId) => {
      const record = await lookup.tenant(tenantId);
      const backend = record === undefined ? undefined : await lookup.backend(record.backendId);
      const app = served.find((candidate) => candidate.id === backend?.app);
      const handle = connected.placements.get(record?.placementId ?? backend?.placementId ?? '');
      if (
        record === undefined ||
        backend === undefined ||
        app === undefined ||
        handle === undefined
      ) {
        throw errors.not_found(`The tenant ${tenantId} does not resolve.`);
      }
      const [row] = await findControlRows(control, 'core.tenant', { id: tenantId });
      // Only the hooks whose latest outcome on the tenant's stream is a failure run again.
      const events = await control.read((unit) =>
        unit.events.readStream({ type: 'core.tenant', id: tenantId }),
      );
      const latest = new Map<string, string>();
      for (const event of events) {
        const hook: unknown = Reflect.get(event.data ?? {}, 'hook');
        if (typeof hook !== 'string') continue;
        if (event.type === 'core.tenant.hookFailed' || event.type === 'core.tenant.hookCompleted') {
          latest.set(hook, event.type);
        }
      }
      const only = new Set(
        [...latest].filter(([, type]) => type === 'core.tenant.hookFailed').map(([hook]) => hook),
      );
      return runTenantHooks({
        store: control,
        registry: app.registry,
        hook: 'onTenantCreated',
        payload: { id: tenantId as never, name: String(row?.name) },
        target: {
          scope: { level: 'tenant', backendId: backend.id, tenantId },
          namespace: record.namespace,
          handle,
        },
        head: app.head,
        config: configOf(app, backend.config),
        rerun: true,
        only,
      });
    },
  };
}
