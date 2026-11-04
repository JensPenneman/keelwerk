import type { StorageScope } from '@keelwerk/core';
import type { scopeSettingNames } from './scope-setting-names.ts';

/** One row-level security setting of a scope: its name and the value the policies read. */
export type ScopeSetting = readonly [(typeof scopeSettingNames)[number], string];

/**
 * The one definition of a scope's settings (decision 111): the tenant or backend id, the
 * namespace marker, or the deployment id. `beginUnitStatements` writes exactly these when a unit
 * opens, and `scopeSettingsStatement` writes them (clearing the others) when a savepoint changes
 * scope, so the two cannot drift apart.
 */
export function scopeSettings(
  scope: StorageScope,
  deploymentId: string | undefined,
): readonly ScopeSetting[] {
  switch (scope.level) {
    case 'tenant':
      return [['keelwerk.tenant_id', scope.tenantId]];
    case 'backend':
      return [['keelwerk.backend_id', scope.backendId]];
    case 'namespace':
      return [['keelwerk.scope', 'namespace']];
    case 'deployment':
      // The policies admit control-root rows only to a unit that names its deployment (F-12).
      if (deploymentId === undefined || deploymentId === '') {
        throw new TypeError('a deployment unit needs the deployment id');
      }
      return [['keelwerk.deployment_id', deploymentId]];
  }
}
