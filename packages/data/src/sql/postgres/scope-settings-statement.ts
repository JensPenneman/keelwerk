import type { StorageScope } from '@keelwerk/core';
import type { PostgresStatement } from './begin-unit-statements.ts';

function valuesOf(scope: StorageScope, deploymentId: string): readonly string[] {
  switch (scope.level) {
    case 'tenant':
      return [scope.tenantId, '', '', ''];
    case 'backend':
      return ['', scope.backendId, '', ''];
    case 'namespace':
      return ['', '', 'namespace', ''];
    case 'deployment':
      return ['', '', '', deploymentId];
  }
}

/**
 * One statement that makes the row-level security settings of a unit those of `scope`, clearing
 * the others (a pooled session keeps a cleared setting as `''`, which every policy reads as
 * absent, decision 111). A savepoint that runs in another scope sets them before its work and
 * puts the unit's own back afterwards. `set_config(..., true)` ends with the transaction, and a
 * rolled-back savepoint takes the change with it.
 */
export function scopeSettingsStatement(
  scope: StorageScope,
  deploymentId: string,
): PostgresStatement {
  if (scope.level === 'deployment' && deploymentId === '') {
    throw new TypeError('a deployment unit needs the deployment id');
  }
  return {
    sql: `select set_config('keelwerk.tenant_id', $1, true), set_config('keelwerk.backend_id', $2, true), set_config('keelwerk.scope', $3, true), set_config('keelwerk.deployment_id', $4, true)`,
    parameters: valuesOf(scope, deploymentId),
  };
}
