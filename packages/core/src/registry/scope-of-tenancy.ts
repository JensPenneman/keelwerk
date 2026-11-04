import type { ActionEntry } from './action-entry.ts';

/** The scope an action of an entity runs in when it declares none: the scope its rows live in. */
export function scopeOfTenancy(tenancy: string): ActionEntry['scope'] {
  return tenancy === 'deployment' || tenancy === 'backend' ? tenancy : 'tenant';
}
