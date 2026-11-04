import type { StorageScope } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { beginUnitStatements } from './begin-unit-statements.ts';
import { scopeSettingNames } from './scope-setting-names.ts';
import { scopeSettings } from './scope-settings.ts';
import { scopeSettingsStatement } from './scope-settings-statement.ts';

const scopes: readonly StorageScope[] = [
  { level: 'tenant', backendId: 'b', tenantId: 't' },
  { level: 'backend', backendId: 'b' },
  { level: 'namespace', reason: 'migrate' },
  { level: 'deployment' },
];

describe('one mapping from a scope to its settings', () => {
  test.each(scopes)('the statement and the unit start agree for a $level scope', (scope) => {
    const wanted = new Map<string, string>(scopeSettings(scope, 'd1'));
    const statement = scopeSettingsStatement(scope, 'd1');
    expect(statement.parameters).toEqual(scopeSettingNames.map((name) => wanted.get(name) ?? ''));
    const begin = beginUnitStatements({ scope, readOnly: false, deploymentId: 'd1' });
    const names = [...(begin.settings[0]?.sql.matchAll(/set_config\('([^']+)'/g) ?? [])].map(
      (match) => match[1],
    );
    expect(names).toEqual([...wanted.keys()]);
    expect(begin.settings[0]?.parameters).toEqual([...wanted.values()]);
  });

  test('the statement clears every setting the scope does not set', () => {
    expect(scopeSettingsStatement({ level: 'backend', backendId: 'b' }, 'd1')).toEqual({
      sql: "select set_config('keelwerk.tenant_id', $1, true), set_config('keelwerk.backend_id', $2, true), set_config('keelwerk.scope', $3, true), set_config('keelwerk.deployment_id', $4, true)",
      parameters: ['', 'b', '', ''],
    });
  });

  test('a deployment scope without its id is refused by both', () => {
    expect(() => scopeSettingsStatement({ level: 'deployment' }, '')).toThrow(TypeError);
    expect(() => scopeSettings({ level: 'deployment' }, undefined)).toThrow(TypeError);
  });
});
