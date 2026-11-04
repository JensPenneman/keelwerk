import type { StorageScope } from '@keelwerk/core';
import type { PostgresStatement } from './begin-unit-statements.ts';
import { scopeSettingNames } from './scope-setting-names.ts';
import { scopeSettings } from './scope-settings.ts';

/**
 * One statement that makes the row-level security settings of a unit those of `scope`, clearing
 * the others (a pooled session keeps a cleared setting as `''`, which every policy reads as
 * absent, decision 111). A savepoint that runs in another scope sets them before its work and
 * puts the unit's own back afterwards. `set_config(..., true)` ends with the transaction, and a
 * rolled-back savepoint takes the change with it. The values come from `scopeSettings`, the
 * definition `beginUnitStatements` uses too.
 */
export function scopeSettingsStatement(
  scope: StorageScope,
  deploymentId: string,
): PostgresStatement {
  const wanted = new Map<string, string>(scopeSettings(scope, deploymentId));
  const calls = scopeSettingNames.map(
    (name, index) => `set_config('${name}', $${index + 1}, true)`,
  );
  return {
    sql: `select ${calls.join(', ')}`,
    parameters: scopeSettingNames.map((name) => wanted.get(name) ?? ''),
  };
}
