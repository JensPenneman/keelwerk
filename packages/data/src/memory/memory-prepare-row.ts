import type { EntityDescriptor, StorageRow } from '@keelwerk/core';
import { KeelwerkError } from '@keelwerk/core';
import { malformedQuery } from '../sql/malformed-query.ts';
import { memoryCloneValue } from './memory-clone-value.ts';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const systemColumns: ReadonlySet<string> = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'archivedAt',
  'version',
  'kwLastHlc',
  'kwLastHash',
  'kwErasedAt',
]);

const requiredColumns = ['id', 'createdAt', 'updatedAt', 'version'] as const;

/**
 * The row as the table stores it: a copy without absent values, checked the way the table's
 * columns would check it. A column the entity does not have is `validation`; the scope column, if
 * the row carries it, must be the unit's (`forbidden`, as the scoping plugin has it); the
 * system columns and the non-optional fields must be present.
 */
export function memoryPrepareRow(
  entity: EntityDescriptor,
  input: StorageRow,
  scopeId: string,
): StorageRow {
  const scopeColumn =
    entity.tenancy === 'tenant' ? 'tenantId' : entity.tenancy === 'backend' ? 'backendId' : null;
  const row: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(input)) {
    if (name === scopeColumn) {
      if (value !== scopeId) {
        throw new KeelwerkError({
          kind: 'forbidden',
          code: 'core.forbidden',
          message: `a row carries another ${name} than the unit's`,
          details: { column: name },
        });
      }
      continue;
    }
    const known =
      systemColumns.has(name) ||
      Object.hasOwn(entity.fields, name) ||
      Object.hasOwn(entity.derivedIndexes, name);
    if (!known) throw malformedQuery(`${entity.ref} has no column ${name}`);
    if (value !== null && value !== undefined) row[name] = memoryCloneValue(value);
  }
  for (const name of requiredColumns) {
    if (row[name] === undefined) throw malformedQuery(`${entity.ref}.${name} is required`);
  }
  if (typeof row.id !== 'string' || !uuidPattern.test(row.id)) {
    throw malformedQuery(`${entity.ref}.id must be a UUID`);
  }
  for (const [name, field] of Object.entries(entity.fields)) {
    if (!field.optional && row[name] === undefined) {
      throw malformedQuery(`${entity.ref}.${name} is required`);
    }
  }
  return row;
}
