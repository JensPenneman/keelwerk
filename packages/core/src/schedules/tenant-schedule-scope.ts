import type { BackendRecord } from '../invoker/backend-record.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { QueueSource } from '../worker/queue-source.ts';
import type { ScheduleScope } from './schedule-scope.ts';

/**
 * The scope of an each-tenant schedule in one tenant, from the tenant's `core.tenant` row and its
 * backend's record, so the fan-out reads each backend once and no tenant again: the tenant's data
 * lives on its own placement when the row names one, else on its backend's. Undefined when that
 * is not `source`'s namespace (another placement of the same app).
 */
export function tenantScheduleScope(
  source: QueueSource,
  backend: BackendRecord,
  row: StorageRow,
): ScheduleScope | undefined {
  const placement = typeof row.placement === 'string' ? row.placement : backend.placementId;
  if (placement !== source.namespace.placementId) return undefined;
  const tenantId = String(row.id);
  return {
    scope: { level: 'tenant', backendId: backend.id, tenantId },
    scopeId: tenantId,
    backendId: backend.id,
    active: backend.status === 'active' && row.status !== 'suspended',
  };
}
