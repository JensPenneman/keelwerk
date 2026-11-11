import { describe, expect, test } from 'vitest';
import type { NamespaceRef } from '../../storage/namespace-ref.ts';
import type { BackendRecord } from '../backend-record.ts';
import type { InvokerEnv } from '../invoker-env.ts';
import type { JobCarrier } from '../job-carrier.ts';
import type { PlacementHandle } from '../placement-handle.ts';
import type { TenantRecord } from '../tenant-record.ts';
import { resolveScope } from './resolve-scope.ts';

function namespace(id: string): NamespaceRef {
  return { id, placementId: 'p-1', appId: 'library', tenantId: null, root: id };
}

const handle = {} as PlacementHandle;
const backend: BackendRecord = {
  id: 'b-1',
  app: 'library',
  placementId: 'p-1',
  namespace: namespace('n-1'),
  status: 'active',
};
const tenant: TenantRecord = {
  id: 't-1',
  backendId: 'b-1',
  placementId: 'p-1',
  namespace: namespace('n-1'),
  status: 'active',
};

function envOf(records: { readonly tenant?: TenantRecord }): InvokerEnv {
  const found = records.tenant ?? tenant;
  return {
    appOf: () => ({}),
    options: {
      placement: () => handle,
      control: { scope: { level: 'deployment' }, namespace: namespace('c-1'), handle },
      directory: {
        hostname: async () => undefined,
        backend: async (id: string) => (id === backend.id ? backend : undefined),
        tenant: async (id: string) => (id === found.id ? found : undefined),
      },
    },
  } as unknown as InvokerEnv;
}

function carrier(
  scope: JobCarrier['scope'],
  from: string,
): { readonly transport: string; readonly job: JobCarrier } {
  return {
    transport: 'job',
    job: {
      scope,
      namespace: from,
      principal: { resolver: 'core.runtime', principalId: 'core.runtime' },
      transport: null,
      attempt: { jobId: '1', attempt: 1 },
      worker: 'w',
      signal: new AbortController().signal,
    },
  };
}

const tenantScope = { level: 'tenant', backendId: 'b-1', tenantId: 't-1' } as const;

describe('resolveScope for a worker’s job', () => {
  test('a tenant job resolves where it was taken from', async () => {
    const resolved = await resolveScope(envOf({}), carrier(tenantScope, 'n-1'));
    expect(resolved.scope).toEqual(tenantScope);
    expect(resolved.target?.namespace.id).toBe('n-1');
  });

  test('a tenant of another backend than the scope names is not found', async () => {
    const strange = { ...tenant, backendId: 'b-2' };
    await expect(
      resolveScope(envOf({ tenant: strange }), carrier(tenantScope, 'n-1')),
    ).rejects.toMatchObject({
      kind: 'not_found',
    });
  });

  test('a scope whose data is in another namespace than the one the job was taken from is not found', async () => {
    await expect(resolveScope(envOf({}), carrier(tenantScope, 'n-other'))).rejects.toMatchObject({
      kind: 'not_found',
    });
  });

  test('a deployment job resolves only from the control namespace', async () => {
    const deployment = { level: 'deployment' } as const;
    await expect(resolveScope(envOf({}), carrier(deployment, 'n-1'))).rejects.toMatchObject({
      kind: 'not_found',
    });
    expect((await resolveScope(envOf({}), carrier(deployment, 'c-1'))).scope).toEqual(deployment);
  });
});
