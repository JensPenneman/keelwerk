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
import { createControlApiUsage } from './create-control-api-usage.ts';
import { createControlFlags } from './create-control-flags.ts';
import { createControlIdentities } from './create-control-identities.ts';
import { createControlLedger } from './create-control-ledger.ts';
import { createControlMarks } from './create-control-marks.ts';
import { createControlQuotas } from './create-control-quotas.ts';
import { createControlRetention } from './create-control-retention.ts';
import { createLeaseUnit } from './create-lease-unit.ts';

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
  const epochs = new Map<string, number>();
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
    quotas: createControlQuotas({ adapter, namespace, registry }),
    apiUsage: createControlApiUsage({
      adapter,
      namespace,
      clock: options.clock,
      deploymentId: options.deploymentId,
    }),
    ledger: createControlLedger(adapter, namespace),
    retention: createControlRetention(adapter, namespace),
    identities: createControlIdentities(adapter, namespace),
    marks: createControlMarks(adapter, namespace, epochs),
    writeLeases: createLeaseUnit(adapter, namespace),
    epochs: () => epochs,
    epochOf: (scope) =>
      epochs.get(
        scope.level === 'tenant'
          ? scope.tenantId
          : scope.level === 'backend'
            ? scope.backendId
            : options.deploymentId,
      ) ?? 0,
    entity: (ref) => {
      const entry = registry.entities.get(ref);
      if (entry === undefined) throw errors.internal(`The registry has no entity ${ref}.`);
      return entry.descriptor;
    },
    read: (fn) => adapter.unit(namespace, { level: 'deployment' }, fn, { readOnly: true }),
  };
}
