import type { EntityDescriptor } from '@keelwerk/core';

/** The column that scopes an entity's rows: `tenant_id`, `backend_id`, none for a deployment entity (section 14.4.2). */
export function scopeColumnName(tenancy: EntityDescriptor['tenancy']): string | null {
  if (tenancy === 'tenant') return 'tenant_id';
  if (tenancy === 'backend') return 'backend_id';
  return null;
}
