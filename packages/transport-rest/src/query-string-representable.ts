import type { FieldNode } from '@keelwerk/core';

const scalarKinds: ReadonlySet<string> = new Set([
  'string',
  'text',
  'integer',
  'float',
  'boolean',
  'enum',
  'id',
  'ref',
  'instant',
  'date',
  'decimal',
  'timeZone',
  'subject',
]);

function isScalar(node: FieldNode): boolean {
  return scalarKinds.has(node.kind);
}

/**
 * A query input is query-string representable when it is an object whose fields are scalars or
 * lists of scalars (section 16.5.2); a query without input is too.
 */
export function queryStringRepresentable(input: FieldNode): boolean {
  if (input.kind === 'void') {
    return true;
  }
  if (input.kind !== 'shape') {
    return false;
  }
  return Object.values(input.fields).every(
    (field) =>
      isScalar(field) || ((field.kind === 'list' || field.kind === 'set') && isScalar(field.item)),
  );
}
