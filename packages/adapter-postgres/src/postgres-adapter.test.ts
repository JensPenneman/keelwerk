import type { AdapterEnvironment, NamespaceRef, PlacementConfig } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { postgresAdapter } from './postgres-adapter.ts';

const namespace = { root: 'app' } as unknown as NamespaceRef;
const placement = {
  id: 'main',
  strategy: 'shared-tables',
  url: 'postgres://app@localhost/none',
} as unknown as PlacementConfig;

describe('the schema operations of the postgres adapter', () => {
  const { schema } = postgresAdapter().create(placement, {} as unknown as AdapterEnvironment);

  test('apply and provision refuse until an owner url exists, never running as the application role', async () => {
    await expect(
      schema.apply(namespace, { id: '0001-initial', track: 'app', steps: [] }),
    ).rejects.toMatchObject({ kind: 'unsupported' });
    await expect(schema.provision(namespace, [])).rejects.toMatchObject({ kind: 'unsupported' });
  });
});
