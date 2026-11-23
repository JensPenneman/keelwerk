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
import type { Scope } from '../storage/scope.ts';
import type { Unit } from '../storage/unit.ts';
import type { ControlApiUsage } from './control-api-usage.ts';
import type { ControlFlags } from './control-flags.ts';
import type { ControlLeaseStore } from './control-lease-store.ts';
import type { ControlLedger } from './control-ledger.ts';
import type { ControlQuotas } from './control-quotas.ts';
import type { ControlRetention } from './control-retention.ts';
import type { NamespaceIdentities } from './namespace-identities.ts';
import type { ScopeMarks } from './scope-marks.ts';

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
  /**
   * The epoch of a scope, part of every state token (section 15.2.6): `epochs()` of the scope's id
   * (the deployment, backend or tenant id), 0 for a scope no restore has moved (S-119).
   */
  epochOf(scope: Scope): number;
  /** The epoch cache: scope id to its highest epoch above 0 over its namespaces. */
  epochs(): ReadonlyMap<string, number>;
  /** kw_namespace_identities, each call in its own deployment unit. */
  readonly identities: NamespaceIdentities;
  /** kw_scope_marks, each call in its own deployment unit; the answers of `bumped` and `bump` feed the epoch cache. */
  readonly marks: ScopeMarks;
  /** The descriptor of a core entity ('core.backend'). */
  entity(ref: string): EntityDescriptor;
  /** The targeting rows of core.flag and their change subscription (WP-98). */
  readonly flags: ControlFlags;
  /** The request counts of this process and the kw_api_usage accessors (S-144). */
  readonly apiUsage: ControlApiUsage;
  /** The deployment's ledger in the control root: erasure and key tombstone records (WP-100, S-125). */
  readonly ledger: ControlLedger;
  /** The core.quota rows and their change subscription (WP-108, S-142). */
  readonly quotas: ControlQuotas;
  /** The runs of the retention worker (14.7.1): kw_retention_runs, each call in its own deployment unit. */
  readonly retention: ControlRetention;
  /** kw_leases, each call in its own deployment unit of the control namespace (S-120). */
  readonly leases: ControlLeaseStore;
  /** Runs `fn` in one writing deployment unit of the control namespace, with the lease store of that unit. */
  writeLeases<T>(fn: (leases: ControlLeaseStore) => Promise<T>): Promise<T>;
  /** Runs `fn` in a read-only deployment-scope unit. */
  read<T>(fn: (unit: Unit) => Promise<T>): Promise<T>;
}
