import type { AnchorSinkStatus, EntityDescriptor, Unit } from '@keelwerk/core';

/** The two members of the core's `ControlStore` that doctor reads through: a read-only deployment-scope unit and the descriptor of a core entity. */
export interface ControlSource {
  read<T>(fn: (unit: Unit) => Promise<T>): Promise<T>;
  entity(ref: string): EntityDescriptor;
  /** The runtime control's per-sink anchor status, when the source has a runtime behind it. */
  anchorSinks?(): readonly AnchorSinkStatus[];
}
