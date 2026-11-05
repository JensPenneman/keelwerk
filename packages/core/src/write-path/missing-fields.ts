import type { EntityEntry } from '../registry/entity-entry.ts';

/** The required fields (serials aside) a created row's values leave out. */
export function missingFields(
  entry: EntityEntry,
  values: Readonly<Record<string, unknown>>,
): readonly string[] {
  return Object.entries(entry.descriptor.fields)
    .filter(
      ([name, field]) => !field.optional && field.kind !== 'serial' && values[name] === undefined,
    )
    .map(([name]) => name);
}
