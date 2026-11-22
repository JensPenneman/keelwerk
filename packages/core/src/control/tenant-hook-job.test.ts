import { describe, expect, test } from 'vitest';
import type { HookEntry } from '../registry/hook-entry.ts';
import type { Scope } from '../storage/scope.ts';
import { hookJobKey } from './hook-job-key.ts';
import { tenantHookJob } from './tenant-hook-job.ts';

const hook: HookEntry = {
  id: 'welcome.onCreated',
  module: 'welcome',
  hook: 'onTenantCreated',
  unit: 'tenant',
  react: () => ({ events: [] }),
};
const scope: Scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' };
const now = Temporal.Instant.from('2026-11-17T08:00:00Z');
const build = { id: 'build-1', revision: 3 };

describe('the job of an onTenantCreated hook', () => {
  test('golden: queue, key, run, command id, principal reference, no API version and no retry', () => {
    expect(
      tenantHookJob({
        hook,
        tenant: { id: 't1', name: 'Acme' },
        scope,
        build,
        now,
        limits: undefined,
      }),
    ).toEqual({
      kind: 'action',
      laneCap: 4,
      createdAt: now,
      queue: 'hooks',
      scope,
      principal: { resolver: 'core.module', principalId: 'welcome.system' },
      causation: { actor: { kind: 'service', id: 'welcome.system', via: 'core.module' } },
      build,
      run: {
        action: 'welcome.onCreated',
        input: { id: 't1', name: 'Acme' },
        commandId: 'kernel:hook:welcome.onCreated:t1',
      },
      key: { value: hookJobKey('welcome.onCreated'), onConflict: 'keep' },
      deadLetter: 'welcome.onCreated',
    });
  });

  test('the key is the kernel-named form of the hook id', () => {
    expect(hookJobKey('welcome.onCreated')).toBe('core.hook:welcome.onCreated');
  });
});
