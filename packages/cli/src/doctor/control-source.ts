import type { EntityDescriptor, Unit } from '@keelwerk/core';

/** What doctor reads the control store through: a read-only deployment-scope unit, which is given the descriptors of the core entities. */
export interface ControlSource {
  read<T>(fn: (unit: Unit, entity: (ref: string) => EntityDescriptor) => Promise<T>): Promise<T>;
}
