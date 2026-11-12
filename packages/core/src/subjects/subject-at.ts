import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { resolveDataSubjectHops } from '../write-path/resolve-data-subject-hops.ts';

/** The data subject a path names in `row`, read through references as the write path reads it. */
export async function subjectAt(
  unit: Unit,
  registry: Registry,
  entry: EntityEntry,
  row: StorageRow,
  path: string,
): Promise<string | undefined> {
  const segments = path.split('.');
  const [first = ''] = segments;
  const value: unknown = first === 'id' ? row.id : row[first];
  if (segments.length === 1) return typeof value === 'string' ? value : undefined;
  const target = entry.descriptor.fields[first]?.ref?.entity;
  if (target === undefined || typeof value !== 'string') return undefined;
  return resolveDataSubjectHops(
    { unit, describe: (ref) => registry.entities.get(ref)?.descriptor },
    target,
    value,
    segments.slice(1),
  );
}
