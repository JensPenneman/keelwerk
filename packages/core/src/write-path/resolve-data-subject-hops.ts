import { errors } from '../errors/errors.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';

/** Where a dotted data-subject path reads the rows it walks through (14.7.4, S-100). */
export interface DataSubjectHops {
  /** Rows the decision did not write or load; hop fields are never personal, so any view of the unit agrees. */
  readonly unit: Unit;
  readonly describe: (entity: string) => EntityDescriptor | undefined;
  /** The decision's rows by entity ref and id: written post-images, then loaded rows; read before the store. */
  readonly decided?: (entity: string, id: string) => StorageRow | undefined;
}

/**
 * Follows `path` from the row `entity/id`: each segment but the last names a reference field of the
 * row it is read from; the last names the field holding the subject id (`id` is the row's own id).
 * Answers undefined when a row or a value is absent or a segment is not a reference.
 * Throws `internal` when a segment names a personal or sealed field or the final value is not a string.
 */
export async function resolveDataSubjectHops(
  hops: DataSubjectHops,
  entity: string,
  id: string,
  path: readonly string[],
): Promise<string | undefined> {
  let descriptor = hops.describe(entity);
  let rowId = id;
  for (const [index, segment] of path.entries()) {
    if (descriptor === undefined) return undefined;
    const row: StorageRow | undefined =
      hops.decided?.(descriptor.ref, rowId) ??
      (await hops.unit.rows.findOne(descriptor, {
        where: { op: 'eq', field: 'id', value: rowId },
        includeArchived: true,
      }));
    if (row === undefined) return undefined;
    const field = segment === 'id' ? undefined : descriptor.fields[segment];
    if (field !== undefined && (field.personal !== false || field.sealed)) {
      throw errors.internal(
        `${descriptor.ref}: the data subject path names the ${field.sealed ? 'sealed' : 'personal'} field "${segment}"`,
      );
    }
    const value: unknown = segment === 'id' ? row.id : row[segment];
    if (index === path.length - 1) {
      if (value === undefined || value === null) return undefined;
      if (typeof value !== 'string') {
        throw errors.internal(
          `${descriptor.ref}: the data subject "${path.join('.')}" is not an id`,
        );
      }
      return value;
    }
    const target = field?.ref?.entity;
    if (target === undefined || typeof value !== 'string') return undefined;
    descriptor = hops.describe(target);
    rowId = value;
  }
  return undefined;
}
