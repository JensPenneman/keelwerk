import type { Anchoring } from '../anchors/start-anchoring.ts';
import { findControlRows } from '../control/find-control-rows.ts';
import { runTenantHooks } from '../control/run-tenant-hooks.ts';
import { errors } from '../errors/errors.ts';
import { moduleConfigOf } from '../invoker/module-config-of.ts';
import { moduleConfigShapes } from '../invoker/module-config-shapes.ts';
import { runtimeOperator } from '../principals/runtime-operator.ts';
import type { Connected } from './connected.ts';
import type { ControlPath } from './control-path.ts';
import type { Migrated } from './migrate-phase.ts';
import type { RuntimeControl } from './runtime-control.ts';
import type { ServedApp } from './served-app.ts';

/** `Runtime.control`: the control path run as the runtime's own operator (S-26, S-27, S-109), plus the hook rerun and the anchor sinks. */
export function createRuntimeControl(input: {
  readonly path: ControlPath;
  readonly served: readonly ServedApp[];
  readonly connected: Connected;
  readonly migrated: Migrated;
  readonly anchoring?: Anchoring;
}): RuntimeControl {
  const { served, connected, migrated, path } = input;
  const { control } = connected;
  const lookup = migrated.directory.lookup;
  const configOf = (
    app: ServedApp,
    stored: Readonly<Record<string, unknown>> | undefined,
  ): ((module: string) => unknown) =>
    moduleConfigOf(moduleConfigShapes(app.source.modules), stored);
  return {
    anchorSinks: () => input.anchoring?.sinkStatus?.() ?? [],
    createBackend: async (backend) => {
      const { id } = await path.createBackend(backend, { principal: runtimeOperator });
      const config = (await lookup.backend(id))?.config;
      return { id, ...(config === undefined ? {} : { config }) };
    },
    createTenant: async (tenant) => {
      const { id } = await path.createTenant(tenant, { principal: runtimeOperator });
      return { id };
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
