import type { EntityDescriptor, PlacementConfig } from '@keelwerk/core';
import type { ConformanceTarget } from './conformance-target.ts';

/** What `describeAdapterConformance` takes (14.10, S-15). */
export interface AdapterConformanceOptions {
  /** Names the `describe` block. */
  readonly name: string;
  /** Opens the adapter once per suite; `entities` are the conformance descriptors it must provision and look up. */
  readonly factory: (entities: readonly EntityDescriptor[]) => Promise<ConformanceTarget>;
  /** The placement the factory opened; its strategy must be one the adapter's capabilities list. */
  readonly placement: PlacementConfig;
  /** True for adapters that talk to a server over real connections: the cases that need them run only then. */
  readonly networked: boolean;
}
