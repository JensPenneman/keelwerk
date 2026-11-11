import { errors } from '../errors/errors.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { DataSubjectHops } from '../write-path/resolve-data-subject-hops.ts';
import { resolveDataSubjectHops } from '../write-path/resolve-data-subject-hops.ts';
import type { SealingContext } from './sealing-context.ts';

/**
 * The data subject of a personal field in a row (14.7.4): `'id'` is the row itself, a field name
 * the subject held by that field, and a dotted path (`accountId.ownerSubject`) follows required
 * references to the row that holds it. `undefined` when the subject is absent. The path walks
 * plain fields of the referenced rows; a subject kept in a personal field is refused. `decided`
 * answers the rows the deciding command wrote or loaded, which are read before the store (S-100).
 */
export async function subjectIdOf(
  context: SealingContext,
  entity: EntityDescriptor,
  path: string,
  row: StorageRow,
  decided?: DataSubjectHops['decided'],
): Promise<string | undefined> {
  const segments = path.split('.');
  const [first = ''] = segments;
  const value: unknown = first === 'id' ? row.id : row[first];
  if (segments.length === 1) {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') {
      throw errors.internal(`${entity.ref}: the data subject "${path}" is not an id`);
    }
    return value;
  }
  const target = entity.fields[first]?.ref?.entity;
  if (target === undefined || typeof value !== 'string') return undefined;
  return resolveDataSubjectHops(
    {
      unit: context.unit,
      describe: context.describe,
      ...(decided === undefined ? {} : { decided }),
    },
    target,
    value,
    segments.slice(1),
  );
}
