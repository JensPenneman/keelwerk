import type { EntityDescriptor } from './entity-descriptor.ts';

/** Per-partition counters of `field.serial({ per })` (section 15.1.4). */
export interface SerialStore {
  /** Allocates `count` consecutive values in one partition; the lock is held until the unit ends. */
  next(
    entity: EntityDescriptor,
    field: string,
    partition: readonly unknown[],
    count?: number,
  ): Promise<bigint>;
}
