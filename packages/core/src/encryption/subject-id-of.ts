import { errors } from '../errors/errors.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { SealingContext } from './sealing-context.ts';

/**
 * The data subject of a personal field in a row (14.7.4): `'id'` is the row itself, a field name
 * the subject held by that field, and a dotted path (`accountId.ownerSubject`) follows required
 * references to the row that holds it. `undefined` when the subject is absent. The path walks
 * plain fields of the referenced rows; a subject kept in a personal field is refused.
 */
export async function subjectIdOf(
  context: SealingContext,
  entity: EntityDescriptor,
  path: string,
  row: StorageRow,
): Promise<string | undefined> {
  const segments = path.split('.');
  let descriptor = entity;
  let current: StorageRow | undefined = row;
  for (const [index, segment] of segments.entries()) {
    if (current === undefined) return undefined;
    const value: unknown = segment === 'id' ? current.id : current[segment];
    if (index === segments.length - 1) {
      if (value === undefined || value === null) return undefined;
      if (typeof value !== 'string') {
        throw errors.internal(`${entity.ref}: the data subject "${path}" is not an id`);
      }
      return value;
    }
    const target = descriptor.fields[segment]?.ref?.entity;
    const next = target === undefined ? undefined : context.describe(target);
    if (next === undefined || typeof value !== 'string') return undefined;
    current = await context.unit.rows.findOne(next, {
      where: { op: 'eq', field: 'id', value },
      includeArchived: true,
    });
    descriptor = next;
  }
  return undefined;
}
