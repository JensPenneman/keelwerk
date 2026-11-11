import type { Scope } from '../storage/scope.ts';

/** One scope a schedule ticks in. */
export interface ScheduleScope {
  readonly scope: Extract<Scope, { readonly level: 'backend' | 'tenant' }>;
  /** The backend id or the tenant id: `kw_schedules.scope_id`. */
  readonly scopeId: string;
  readonly backendId: string;
  /** False when the backend or the tenant is suspended: its ticks are skipped. */
  readonly active: boolean;
}
