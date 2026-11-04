import type { FieldNode, SurfaceEntity } from '@keelwerk/core';
import { toWire } from '@keelwerk/core/wire';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A row can lack any field: a selection or a mask removed it, so every member is optional on the wire (section 16.4.5). */
function rowNodeOf(entity: SurfaceEntity): FieldNode {
  return {
    kind: 'shape',
    optional: false,
    access: 'read',
    fields: Object.fromEntries(
      Object.entries(entity.fields).map(([name, node]) => [name, { ...node, optional: true }]),
    ),
  };
}

/** The wire form of one row of an entity; the `$masked` member survives when the kernel set it. */
export function encodeRow(entity: SurfaceEntity, row: unknown): unknown {
  const encoded = toWire(rowNodeOf(entity), row);
  if (isRecord(row) && Array.isArray(row.$masked) && isRecord(encoded)) {
    return { ...encoded, $masked: row.$masked };
  }
  return encoded;
}
