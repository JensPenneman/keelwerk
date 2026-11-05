import type {
  AdapterCapabilities,
  DataAdapter,
  NamespaceRef,
  PlacementConfig,
  StorageScope,
  Unit,
  UnitOptions,
} from '@keelwerk/core';
import type { ConformanceClock } from './conformance-clock.ts';

/** What a case file sees of the adapter under test; every member reads the current target. */
export interface ConformanceSubject {
  readonly name: string;
  readonly placement: PlacementConfig;
  readonly networked: boolean;
  /** The deployment id the adapter was created with, when the suite knows it. */
  readonly deploymentId?: string | undefined;
  /** The target's clock, when it has one. */
  readonly clock?: ConformanceClock | undefined;
  adapter(): DataAdapter;
  namespace(): NamespaceRef;
  capabilities(): AdapterCapabilities;
  /** A read-write unit on the target's namespace. */
  run<T>(scope: StorageScope, fn: (unit: Unit) => Promise<T>, options?: UnitOptions): Promise<T>;
  /** A read-only unit. */
  read<T>(scope: StorageScope, fn: (unit: Unit) => Promise<T>): Promise<T>;
}
