import type { ScopeLookup } from '../invoker/scope-lookup.ts';
import type { ScheduleEntry } from '../registry/schedule-entry.ts';
import type { QueueSource } from '../worker/queue-source.ts';
import type { ScheduleScope } from './schedule-scope.ts';
import { withinSignal } from './within-signal.ts';

/**
 * The scope of a `kw_schedules` row in `source`, through the directory: `'gone'` when the id is
 * unknown at both levels (the row has no owner left and may be deleted), `'elsewhere'` when the scope
 * exists but runs another app or keeps its data in another namespace, or when the id belongs to the
 * other level than this build's entry names (another build, rolling in, changed the schedule's scope
 * and seeded the row: left alone, looked at again later). Every directory read stops waiting when
 * `signal` aborts (the ticker's stop deadline), with the signal's reason.
 */
export async function scheduleScopeOf(
  directory: ScopeLookup,
  source: QueueSource,
  entry: ScheduleEntry,
  scopeId: string,
  signal: AbortSignal,
): Promise<ScheduleScope | 'gone' | 'elsewhere'> {
  const { namespace } = source;
  const backendOf = (id: string) => withinSignal(directory.backend(id), signal);
  const tenantOf = (id: string) => withinSignal(directory.tenant(id), signal);
  if (entry.scope === 'backend') {
    const backend = await backendOf(scopeId);
    if (backend === undefined) {
      return (await tenantOf(scopeId)) === undefined ? 'gone' : 'elsewhere';
    }
    if (backend.app !== namespace.appId || backend.namespace.id !== namespace.id) {
      return 'elsewhere';
    }
    return {
      scope: { level: 'backend', backendId: backend.id },
      scopeId: backend.id,
      backendId: backend.id,
      active: backend.status === 'active',
    };
  }
  const tenant = await tenantOf(scopeId);
  if (tenant === undefined) {
    return (await backendOf(scopeId)) === undefined ? 'gone' : 'elsewhere';
  }
  if (tenant.namespace.id !== namespace.id) return 'elsewhere';
  const backend = await backendOf(tenant.backendId);
  if (backend === undefined) return 'gone';
  if (backend.app !== namespace.appId) return 'elsewhere';
  return {
    scope: { level: 'tenant', backendId: backend.id, tenantId: tenant.id },
    scopeId: tenant.id,
    backendId: backend.id,
    active: backend.status === 'active' && tenant.status === 'active',
  };
}
