import type { InvocationSession } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { tenantAddress } from '../../src/replay/tenant-address.ts';
import { bootFlags, flagsApp, variables } from './support/flags-kit.ts';

const operator = {
  scope: { level: 'deployment' },
  app: 'flags-app',
  principal: { kind: 'operator', id: 'op', subject: 'op', roles: [], scopes: [] },
  apiVersion: '2026-11-04',
  deprecation: null,
  resolvedBy: 'local',
  revalidate: () => Promise.reject(new Error('unused')),
} as unknown as InvocationSession;

/** The `explain --dry-run` of `gates.suspendable` as ada, and the real call, with `gates.live` as given. */
async function dryRunWith(live: string) {
  const { runtime, call } = await bootFlags(flagsApp, {
    env: variables(['KEELWERK_FLAG_GATES_LIVE', live]),
  });
  const address = tenantAddress(runtime);
  const dry = await runtime.invoker.invoke({
    action: 'core.explain',
    input: {
      mode: 'dry-run',
      ref: 'gates.suspendable',
      as: 'user:ada',
      backend: address.scope.level === 'tenant' ? address.scope.backendId : '',
      tenant: address.tenant.id,
      input: {},
    },
    carrier: { transport: 'cli', local: { inProcess: true } },
    session: operator,
    requestId: 'dry-1',
    signal: new AbortController().signal,
  });
  return { dry, real: await call('gates.suspendable', {}) };
}

describe('an explain dry run and its kill switch', () => {
  test('an explain dry run of an action whose kill switch is closed answers core.feature_suspended', async () => {
    const { dry, real } = await dryRunWith('false');
    expect(real).toMatchObject({ ok: false, error: { code: 'core.feature_suspended' } });
    expect(dry).toMatchObject({ ok: false, error: { code: 'core.feature_suspended' } });
  });

  test('an explain dry run of an action whose kill switch is open runs', async () => {
    const { dry, real } = await dryRunWith('true');
    expect(real).toMatchObject({ ok: true });
    expect(dry).toMatchObject({ ok: true });
  });
});
