import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { RecordedRead } from '../events/recorded-read.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import { createEntityRepository } from '../repositories/entity-repository.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';

/** What loading a row for a draft needs. */
export interface ResolveDraftInput {
  readonly unit: Unit;
  readonly entry: EntityEntry;
  readonly id: string;
  /** The version the draft was built from; absent for a draft built from an id (S-21). */
  readonly expectedVersion?: number;
  /** The decision record's reads: a draft by id records its load there (S-21). */
  readonly reads: RecordedRead[];
}

/**
 * Loads and locks the row a draft changes (section 15.1.6, step 9; S-21). A draft built from an
 * id has no expected version: the row's version at the lock is used and the load is recorded in
 * `reads`; an absent row is `not_found`. A draft built from a row must find that version still
 * there, else `core.version_mismatch`, which the retries take up.
 */
export async function resolveDraftById(input: ResolveDraftInput): Promise<StorageRow> {
  const { unit, entry, id } = input;
  const found = await createEntityRepository(unit, entry).find({
    where: { op: 'eq', field: 'id', value: id },
    page: { first: 1 },
    includeArchived: true,
    forUpdate: true,
  });
  const row = found.rows[0];
  if (row === undefined) throw errors.not_found(`${entry.ref} ${id} does not exist`);
  if (input.expectedVersion === undefined) {
    input.reads.push({ at: found.position });
  } else if (Number(row.version) !== input.expectedVersion) {
    throw new KeelwerkError({
      kind: 'conflict',
      code: 'core.version_mismatch',
      message: 'The row changed since it was read.',
      details: { entity: entry.ref, id, expectedVersion: input.expectedVersion },
    });
  }
  return row;
}
