import type { DataAdapter, DataAdapterFactory, NamespaceRef, StorageScope } from '@keelwerk/core';
import { factoryOf, type Kind } from './runtime-kit.ts';

/** The adapters a runtime opens, with the namespace and scope of the first unit each level ran. */
export interface Watched {
  readonly seen: Map<
    string,
    { adapter: DataAdapter; namespace: NamespaceRef; scope: StorageScope }
  >;
}

/** A factory that remembers, by scope level, where a unit first ran, so a test can look at the store afterwards. */
export function watching(kind: Kind, watched: Watched): DataAdapterFactory {
  const inner = factoryOf(kind);
  return {
    ...inner,
    create: (placement, env): DataAdapter => {
      const adapter = inner.create(placement, env);
      return {
        ...adapter,
        unit: (namespace, scope, fn, options) => {
          const key = `${placement.id}/${scope.level}`;
          if (!watched.seen.has(key)) watched.seen.set(key, { adapter, namespace, scope });
          return adapter.unit(namespace, scope, fn, options);
        },
      };
    },
  };
}
