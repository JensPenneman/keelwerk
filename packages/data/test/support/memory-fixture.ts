import type {
  AdapterEnvironment,
  DataAdapter,
  EntityDescriptor,
  Logger,
  NamespaceRef,
  StorageScope,
  Unit,
} from '@keelwerk/core';
import { memoryAdapter } from '../../src/memory/memory-adapter.ts';
import { entities } from './entities.ts';
import { namespaceOf } from './namespace-of.ts';
import { stamp } from './stamp.ts';
import type { TestClock } from './test-clock.ts';
import { testClock } from './test-clock.ts';

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

export interface MemoryFixture {
  readonly adapter: DataAdapter;
  readonly namespace: NamespaceRef;
  readonly clock: TestClock;
  /** A read-write unit. */
  run<T>(scope: StorageScope, fn: (unit: Unit) => Promise<T>): Promise<T>;
  /** A read-only unit. */
  read<T>(scope: StorageScope, fn: (unit: Unit) => Promise<T>): Promise<T>;
}

export function openMemory(
  extra: readonly EntityDescriptor[] = [],
  namespace: NamespaceRef = namespaceOf,
): MemoryFixture {
  const clock = testClock(stamp);
  const known = new Map([...entities, ...extra.map((entity) => [entity.ref, entity] as const)]);
  const environment: AdapterEnvironment = {
    deploymentId: '00000000-0000-4000-8000-0000000000d1',
    log: silent,
    tracer: {} as AdapterEnvironment['tracer'],
    secrets: { resolve: async () => '' },
    signal: new AbortController().signal,
  };
  const adapter = memoryAdapter({ clock, entities: (ref) => known.get(ref) }).create(
    { id: 'main', strategy: 'shared-tables' },
    environment,
  );
  return {
    adapter,
    namespace,
    clock,
    run: (scope, fn) => adapter.unit(namespace, scope, fn),
    read: (scope, fn) => adapter.unit(namespace, scope, fn, { readOnly: true }),
  };
}
