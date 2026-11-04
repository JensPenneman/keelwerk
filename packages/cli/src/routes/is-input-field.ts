import type { FieldNode } from '@keelwerk/core';

/** A field a caller can set: not system-written (`read`), and not a serial, blob, page or void. */
export function isInputField(node: FieldNode): boolean {
  return (
    node.access !== 'read' &&
    node.kind !== 'serial' &&
    node.kind !== 'blob' &&
    node.kind !== 'page' &&
    node.kind !== 'void'
  );
}
