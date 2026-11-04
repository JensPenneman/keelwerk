import type { HybridClock } from '../clock/hybrid-clock.ts';
import type { ControlStore } from '../control/control-store.ts';
import type { BuildIdentity } from '../events/build-identity.ts';
import type { PlacementHandle } from '../invoker/placement-handle.ts';
import type { ScopeLookup } from '../invoker/scope-lookup.ts';
import type { ComputePool } from '../kernel/compute-pool.ts';
import type { KeyService } from '../kernel/key-service.ts';
import type { SecretResolver } from '../kernel/secret-resolver.ts';
import type { Logger } from '../observability/logger.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { SchemaTrack } from './schema-planner.ts';

/** What the `connect` phase leaves open: the adapters, the key service and the control store. */
export interface Connected {
  readonly deploymentId: string;
  /** The node id this process registered with (14.5.3). */
  readonly nodeId: string;
  readonly hybridClock: HybridClock;
  readonly build: BuildIdentity;
  readonly secrets: SecretResolver;
  readonly keys: KeyService;
  readonly compute: ComputePool;
  readonly control: ControlStore;
  /** The placements this process opened, by name. */
  readonly placements: ReadonlyMap<string, PlacementHandle>;
  /** Placement name to the id of its `core.placement` row. */
  readonly placementIds: ReadonlyMap<string, string>;
  /** The migration tracks the modules ship, loaded once. */
  readonly tracks: readonly SchemaTrack[];
  /** The row id of this process in `core.process`. */
  readonly processId: string;
  readonly log: Logger;
  /** Aborts when the process stops: the adapters' environment signal. */
  readonly signal: AbortSignal;
  /** Called once the key service exists, so the wrapper handed to the adapters can reach it. */
  readonly adapters: readonly DataAdapter[];
  /** Hands the wrapper of the adapters the directory once it exists. */
  bindDirectory(directory: ScopeLookup): void;
}
