import { findControlRows } from '../control/find-control-rows.ts';
import type { StartPhaseInput } from '../runtime/start-phase-input.ts';
import type { QueueSource } from './queue-source.ts';

/**
 * The namespaces the fetchers sweep, read once at start (D1): the app namespaces recorded in
 * `core.namespace` (the rows without a tenant, one per connected placement and served app, mapped as
 * the namespace book maps them), then the control store's own namespace for deployment-scope jobs.
 * Rows of an app this process does not serve or of a placement it is not connected to are left out.
 * Per-tenant namespaces arrive with M5, which needs the sweep of 9.5.6.
 */
export async function queueSources(input: StartPhaseInput): Promise<readonly QueueSource[]> {
  const { connected, apps } = input;
  const { control } = connected;
  const placements = new Map([...connected.placementIds].map(([name, id]) => [id, name] as const));
  const rows = await findControlRows(control, 'core.namespace', { tenantId: { isNull: true } });
  const sources: QueueSource[] = [];
  for (const row of rows) {
    const placement = placements.get(String(row.placementId));
    const handle = placement === undefined ? undefined : connected.placements.get(placement);
    const app = apps.get(String(row.appId));
    if (placement === undefined || handle === undefined || app === undefined) continue;
    sources.push({
      namespace: {
        id: String(row.id),
        placementId: placement,
        appId: app.id,
        tenantId: null,
        root: String(row.root),
      },
      handle,
      registry: app.registry,
    });
  }
  sources.push({
    namespace: control.namespace,
    handle: { adapter: control.adapter, capabilities: control.capabilities },
    registry: control.registry,
  });
  return sources;
}
