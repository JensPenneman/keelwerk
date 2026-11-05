import type {
  AdapterCapabilities,
  DataAdapter,
  DataAdapterFactory,
  NamespaceRef,
} from '@keelwerk/core';

/** The adapters a slice-2 deployment opened, by placement id, and the namespace of the app on `main`. */
export interface Slice2Adapters {
  readonly factory: DataAdapterFactory;
  /** The adapter the latest boot opened for a placement. */
  adapter(placement: string): DataAdapter;
  /** The namespace the app uses on `main`, as the runtime addressed it. */
  namespace(): NamespaceRef;
  /** Closes what `keep` held open. */
  closeAll(): Promise<void>;
}

/**
 * Wraps a factory so a test sees the adapters it creates. With `keep`, one adapter per placement
 * outlives the runtime that opened it: `connect` answers the first capabilities again and `close`
 * waits for `closeAll`, so an in-memory database survives a stop and a second boot (the release
 * step, then production).
 */
export function slice2Adapters(inner: DataAdapterFactory, keep: boolean): Slice2Adapters {
  const latest = new Map<string, DataAdapter>();
  const held = new Map<string, { readonly adapter: DataAdapter; readonly created: DataAdapter }>();
  let namespace: NamespaceRef | undefined;
  const wrap = (placementId: string, created: DataAdapter): DataAdapter => {
    let capabilities: AdapterCapabilities | undefined;
    return {
      ...created,
      connect: async () => {
        if (keep && capabilities !== undefined) return capabilities;
        capabilities = await created.connect();
        return capabilities;
      },
      close: async (deadlineMs) => {
        if (!keep) await created.close(deadlineMs);
      },
      unit: (ns, scope, fn, options) => {
        if (placementId === 'main') namespace = ns;
        return created.unit(ns, scope, fn, options);
      },
      schema: {
        ...created.schema,
        provision: async (ns, snapshots, options) => {
          await created.schema.provision(ns, snapshots, options);
          if (placementId === 'main') namespace = ns;
        },
        history: async (ns) => {
          if (placementId === 'main') namespace = ns;
          return created.schema.history(ns);
        },
      },
    };
  };
  return {
    factory: {
      ...inner,
      create: (placement, env) => {
        const existing = keep ? held.get(placement.id) : undefined;
        if (existing !== undefined) {
          latest.set(placement.id, existing.adapter);
          return existing.adapter;
        }
        const created = inner.create(placement, env);
        const adapter = wrap(placement.id, created);
        latest.set(placement.id, adapter);
        if (keep) held.set(placement.id, { adapter, created });
        return adapter;
      },
    },
    adapter: (placement) => {
      const found = latest.get(placement);
      if (found === undefined) throw new Error(`no adapter opened for placement ${placement}`);
      return found;
    },
    namespace: () => {
      if (namespace === undefined) throw new Error('the app has not used its namespace yet');
      return namespace;
    },
    closeAll: async () => {
      await Promise.all([...held.values()].map(async (entry) => entry.created.close(1000)));
    },
  };
}
