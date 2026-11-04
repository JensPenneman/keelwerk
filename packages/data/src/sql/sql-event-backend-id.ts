import { errors } from '@keelwerk/core';
import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * `kw_events.backend_id` of the unit's events: the backend of a tenant or backend unit, and the
 * deployment's id for the deployment's own log (its `scope_id` has no backend).
 */
export function sqlEventBackendId(ctx: SqlUnitContext): string {
  switch (ctx.scope.level) {
    case 'tenant':
    case 'backend':
      return ctx.scope.backendId;
    case 'deployment':
      return ctx.deploymentId;
    case 'namespace':
      throw errors.internal('a namespace-scope unit has no event log');
  }
}
