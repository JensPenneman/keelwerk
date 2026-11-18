import { describe, expect, test } from 'vitest';
import { departedScopes } from './departed-scopes.ts';

const deploymentId = '0192f3a0-0000-7000-8000-0000000000d1';
const here = '0192f3a0-0000-7000-8000-0000000000b1';
const there = '0192f3a0-0000-7000-8000-0000000000b2';
const tenantHere = '0192f3a0-0000-7000-8000-000000000001';
const tenantThere = '0192f3a0-0000-7000-8000-000000000002';
const backendHere = '0192f3a0-0000-7000-8000-0000000000a1';
const backendThere = '0192f3a0-0000-7000-8000-0000000000a2';
const unknown = '0192f3a0-0000-7000-8000-0000000000ff';

const connected = { deploymentId, control: { namespace: { id: 'control' } } } as never;
const directory = (failing = false) =>
  ({
    hostname: async () => undefined,
    backend: async (id: string) => {
      if (failing) throw new Error('the directory is down');
      if (id === backendHere) return { id, namespace: { id: here } };
      if (id === backendThere) return { id, namespace: { id: there } };
      return undefined;
    },
    tenant: async (id: string) => {
      if (failing) throw new Error('the directory is down');
      if (id === tenantHere) return { id, namespace: { id: here } };
      if (id === tenantThere) return { id, namespace: { id: there } };
      return undefined;
    },
  }) as never;

describe('the scopes the directory places in another namespace', () => {
  test('a tenant or backend placed elsewhere, an unknown id and the deployment id in an app namespace are departed', async () => {
    const departed = await departedScopes({
      connected,
      directory: directory(),
      namespaceId: here,
      scopeIds: [tenantThere, backendThere, unknown, deploymentId],
    });
    expect([...departed].sort()).toEqual([tenantThere, backendThere, unknown, deploymentId].sort());
  });

  test('a tenant or backend placed here, and the deployment id in the control namespace, are kept', async () => {
    expect(
      await departedScopes({
        connected,
        directory: directory(),
        namespaceId: here,
        scopeIds: [tenantHere, backendHere],
      }),
    ).toEqual(new Set());
    expect(
      await departedScopes({
        connected,
        directory: directory(),
        namespaceId: 'control',
        scopeIds: [deploymentId],
      }),
    ).toEqual(new Set());
  });

  test('a lookup that fails is not caught', async () => {
    await expect(
      departedScopes({
        connected,
        directory: directory(true),
        namespaceId: here,
        scopeIds: [tenantHere],
      }),
    ).rejects.toThrow('the directory is down');
  });
});
