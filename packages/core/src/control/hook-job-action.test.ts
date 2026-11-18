import { describe, expect, test } from 'vitest';
import type { HookEntry } from '../registry/hook-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import { hookJobAction } from './hook-job-action.ts';

const tenantHook: HookEntry = {
  id: 'welcome.onCreated',
  module: 'welcome',
  hook: 'onTenantCreated',
  unit: 'tenant',
  react: (payload) => ({ events: [], result: payload }) as never,
};
const backendHook: HookEntry = {
  id: 'welcome.onBackend',
  module: 'welcome',
  hook: 'onBackendCreated',
  unit: 'backend',
  react: () => ({ events: [] }),
};
const registry = {
  hooks: new Map([
    [tenantHook.id, tenantHook],
    [backendHook.id, backendHook],
  ]),
} as unknown as Registry;
const tenant: Scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' };

describe('the command a hook job decides as', () => {
  test('is the hook as a module command of its unit, taking the payload', () => {
    const action = hookJobAction(registry, 'welcome.onCreated', tenant, '2026-11-01');
    expect(action).toMatchObject({
      ref: 'welcome.onCreated',
      module: 'welcome',
      name: 'onCreated',
      kind: 'command',
      scope: 'tenant',
      since: '2026-11-01',
      auth: 'policy',
      errors: [],
    });
    const valid = { id: 't1', name: 'Acme' };
    expect(action.input['~standard'].validate(valid)).toEqual({ value: valid });
    expect(action.input['~standard'].validate({ name: 'Acme' })).toHaveProperty('issues');
  });

  test('is not_implemented for an unknown ref and for a backend hook in a tenant scope', () => {
    for (const ref of ['welcome.missing', 'welcome.onBackend']) {
      expect(() => hookJobAction(registry, ref, tenant, '2026-11-01')).toThrow(
        expect.objectContaining({ kind: 'not_implemented', code: 'core.not_implemented' }),
      );
    }
  });
});
