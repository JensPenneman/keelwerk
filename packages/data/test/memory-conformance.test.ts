import type { AdapterEnvironment, EntityDescriptor, Logger, PlacementConfig } from '@keelwerk/core';
import { describeAdapterConformance } from '@keelwerk/testing';
import { expect, test } from 'vitest';
import { memoryAdapter } from '../src/memory/memory-adapter.ts';
import { offsetClock } from './support/offset-clock.ts';

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

const environment: AdapterEnvironment = {
  deploymentId: '00000000-0000-4000-8000-0000000000d1',
  log: silent,
  tracer: {} as AdapterEnvironment['tracer'],
  secrets: { resolve: async () => '' },
  signal: new AbortController().signal,
};

const placement: PlacementConfig = { id: 'main', strategy: 'shared-tables' };

describeAdapterConformance({
  name: 'memory',
  placement,
  networked: false,
  factory: async (entities: readonly EntityDescriptor[]) => {
    const known = new Map(entities.map((entity) => [entity.ref, entity]));
    const clock = offsetClock();
    const open = () =>
      memoryAdapter({ clock, entities: (ref) => known.get(ref) }).create(placement, environment);
    let adapter = open();
    return {
      get adapter() {
        return adapter;
      },
      clock,
      namespace: {
        id: 'ns-conformance',
        placementId: 'main',
        appId: 'conf',
        tenantId: null,
        root: 'conf',
      },
      reset: async () => {
        await adapter.close(100);
        adapter = open();
      },
      close: async () => {
        await adapter.close(100);
      },
    };
  },
});

test('the memory adapter declares the reference limits the suites rely on', async () => {
  const adapter = memoryAdapter().create(placement, environment);
  const capabilities = await adapter.connect();
  expect(capabilities.encryptedQueries.maxScan).toBe(10_000);
  expect(capabilities.processes).toBe('single');
  expect(capabilities.positionPaging).toEqual({ maxOffset: 10_000 });
});
