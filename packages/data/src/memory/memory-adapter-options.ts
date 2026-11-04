import type { Clock, EntityDescriptor } from '@keelwerk/core';

/** What `memoryAdapter` takes; every member is optional. */
export interface MemoryAdapterOptions {
  /** The time source of bucket refills, lease deadlines and key timestamps; default: the system clock. */
  readonly clock?: Clock;
  /**
   * Finds the descriptor of a relation's target by entity ref. The adapter also learns every
   * descriptor a store call names, so this is needed only for a target no row was written to.
   */
  readonly entities?: (ref: string) => EntityDescriptor | undefined;
}
