import type { FieldNode, SurfaceAction } from '@keelwerk/core';

/** The input of an action as it travels in a body: instance commands take `id` from the path and `ifVersion` from `If-Match`. */
export function bodyNodeOf(action: SurfaceAction): FieldNode {
  const input = action.input;
  if (input.kind !== 'shape' || !action.instance) {
    return input;
  }
  return {
    ...input,
    fields: Object.fromEntries(
      Object.entries(input.fields).filter(([name]) => name !== 'id' && name !== 'ifVersion'),
    ),
  };
}
