import type { FieldDescriptor, FieldKind } from '@keelwerk/core';

export function fieldOf(
  kind: FieldKind,
  column: string,
  over: Partial<FieldDescriptor> = {},
): FieldDescriptor {
  return {
    kind,
    column,
    optional: true,
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
    tag: 0,
    ...over,
  };
}
