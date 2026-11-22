import type { EntityDescriptor, Unit } from '@keelwerk/core';

/** The two members of the core's `ControlStore` that doctor reads through: a read-only deployment-scope unit and the descriptor of a core entity. */
export interface ControlSource {
  read<T>(fn: (unit: Unit) => Promise<T>): Promise<T>;
  entity(ref: string): EntityDescriptor;
}
