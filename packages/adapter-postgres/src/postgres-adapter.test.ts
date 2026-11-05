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

describe('the application role of a placement', () => {
  const environment = {} as unknown as AdapterEnvironment;
  const owned = (url: string | undefined): PlacementConfig =>
    ({ ...placement, ...(url === undefined ? {} : { url }) }) as unknown as PlacementConfig;
  const factory = postgresAdapter({ ownerUrl: 'postgres://owner@localhost/none' });

  test('a placement url without a user is refused when an owner url is set, naming the placement', () => {
    expect(() => factory.create(owned('postgres://localhost/none'), environment)).toThrow(
      expect.objectContaining({ kind: 'validation', message: expect.stringContaining('main') }),
    );
  });

  test('without an owner url the adapter is created whatever the url names', () => {
    expect(() =>
      postgresAdapter().create(owned('postgres://localhost/none'), environment),
    ).not.toThrow();
    expect(() =>
      postgresAdapter().create(owned('postgres://App@localhost/none'), environment),
    ).not.toThrow();
  });
});
