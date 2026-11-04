import type { FieldDescriptor, FieldKind } from '@keelwerk/core';
import { physicalColumnName } from '@keelwerk/core';

/** A hand-built field descriptor: plain, required, last-writer-wins, with its physical column. */
export function fieldDescriptor(
  name: string,
  kind: FieldKind,
  overrides: Partial<FieldDescriptor> = {},
): FieldDescriptor {
  return {
    kind,
    column: physicalColumnName(name),
    optional: false,
    unique: false,
    indexed: false,
    hidden: false,
    maskable: false,
    stateOnly: false,
    sealed: false,
    merge: 'lww',
    personal: false,
    constraints: {},
    ref: null,
    inner: null,
    codec: null,
    tag: 1,
    ...overrides,
  };
}
