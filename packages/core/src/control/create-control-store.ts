import type { HybridClock } from '../clock/hybrid-clock.ts';
import { errors } from '../errors/errors.ts';
import type { Clock } from '../kernel/clock.ts';
import type { ComputePool } from '../kernel/compute-pool.ts';
import type { KeyService } from '../kernel/key-service.ts';
import type { Logger } from '../observability/logger.ts';
import type { Registry } from '../registry/registry.ts';
import type { AdapterCapabilities } from '../storage/adapter-capabilities.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { ControlStore } from './control-store.ts';
import { createControlFlags } from './create-control-flags.ts';

/** What the control store is built from. */
export interface ControlStoreOptions {
  readonly adapter: DataAdapter;
  readonly capabilities: AdapterCapabilities;
  readonly namespace: NamespaceRef;
  readonly registry: Registry;
  readonly deploymentId: string;
  readonly clock: Clock;
  readonly keys: KeyService;
  readonly compute: ComputePool;
  readonly log: Logger;
  readonly hybridClock: HybridClock;
  readonly build: { readonly id: string; readonly revision: number };
}

/** The control store over a connected adapter. */
export function createControlStore(options: ControlStoreOptions): ControlStore {
  const { adapter, namespace, registry } = options;
  return {
    adapter,
    capabilities: options.capabilities,
    namespace,
    registry,
    deploymentId: options.deploymentId,
    clock: options.clock,
    keys: options.keys,
    compute: options.compute,
    log: options.log,
    writer: { hybridClock: options.hybridClock, build: options.build },
    flags: createControlFlags({ adapter, namespace, registry }),
    epochOf: () => 0,
    entity: (ref) => {
      const entry = registry.entities.get(ref);
      if (entry === undefined) throw errors.internal(`The registry has no entity ${ref}.`);
      return entry.descriptor;
    },
    read: (fn) => adapter.unit(namespace, { level: 'deployment' }, fn, { readOnly: true }),
  };
}
