import type {
  AdapterCapabilities,
  DataAdapter,
  NamespaceRef,
  PlacementConfig,
  StorageScope,
  Unit,
  UnitOptions,
} from '@keelwerk/core';

/** What a case file sees of the adapter under test; every member reads the current target. */
export interface ConformanceSubject {
  readonly name: string;
  readonly placement: PlacementConfig;
  readonly networked: boolean;
  adapter(): DataAdapter;
  namespace(): NamespaceRef;
  capabilities(): AdapterCapabilities;
  /** A read-write unit on the target's namespace. */
  run<T>(scope: StorageScope, fn: (unit: Unit) => Promise<T>, options?: UnitOptions): Promise<T>;
  /** A read-only unit. */
  read<T>(scope: StorageScope, fn: (unit: Unit) => Promise<T>): Promise<T>;
}
