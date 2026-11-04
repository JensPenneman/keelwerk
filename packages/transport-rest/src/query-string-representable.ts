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
 * lists of scalars (section 16.5.2), `filter` travelling as JSON and `sort` in the compact form,
 * whatever their node; a query without input is too.
 */
export function queryStringRepresentable(input: FieldNode): boolean {
  if (input.kind === 'void') {
    return true;
  }
  if (input.kind !== 'shape') {
    return false;
  }
  return Object.entries(input.fields).every(
    ([name, field]) =>
      name === 'filter' ||
      name === 'sort' ||
      isScalar(field) ||
      ((field.kind === 'list' || field.kind === 'set') && isScalar(field.item)),
  );
}
