import type { EntityDescriptor } from '@keelwerk/core';

/** The descriptors of the conformance app, by role. */
export interface ConformanceEntitySet {
  readonly kitchen: EntityDescriptor;
  readonly owner: EntityDescriptor;
  readonly probe: EntityDescriptor;
  readonly credential: EntityDescriptor;
  readonly ticket: EntityDescriptor;
  readonly account: EntityDescriptor;
  readonly setting: EntityDescriptor;
  readonly network: EntityDescriptor;
}
