import type { HybridClock } from '../clock/hybrid-clock.ts';
import type { Clock } from '../kernel/clock.ts';
import type { ComputePool } from '../kernel/compute-pool.ts';
import type { KeyService } from '../kernel/key-service.ts';
import type { Logger } from '../observability/logger.ts';
import type { Registry } from '../registry/registry.ts';
import type { AdapterCapabilities } from '../storage/adapter-capabilities.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { Unit } from '../storage/unit.ts';

/**
 * The control store (section 14.2): the deployment namespace of the core module in the control
 * adapter, the one place `core.backend`, `core.tenant`, `core.domain`, `core.placement`,
 * `core.namespace` and `core.process` live. The runtime reads it through read-only deployment-scope
 * units and writes it through commands it runs below the pipeline (`runControlCommand`).
 */
export interface ControlStore {
  readonly adapter: DataAdapter;
  readonly capabilities: AdapterCapabilities;
  readonly namespace: NamespaceRef;
  /** The registry the core's entities come from. */
  readonly registry: Registry;
  /** The deployment id, which is also the scope id of deployment-scope units. */
  readonly deploymentId: string;
  readonly clock: Clock;
  readonly keys: KeyService;
  readonly compute: ComputePool;
  readonly log: Logger;
  /** The process clock the events' readings come from and the build they carry (S-22). */
  readonly writer: {
    readonly hybridClock: HybridClock;
    readonly build: { readonly id: string; readonly revision: number };
  };
  /** The descriptor of a core entity ('core.backend'). */
  entity(ref: string): EntityDescriptor;
  /** Runs `fn` in a read-only deployment-scope unit. */
  read<T>(fn: (unit: Unit) => Promise<T>): Promise<T>;
}
