import type { EntityEntry, FieldDescriptor } from '@keelwerk/core';

/** The entry with its descriptor's fields replaced: add, change or (by omitting) remove a field. */
export function entryWithFields(
  entry: EntityEntry,
  fields: Readonly<Record<string, FieldDescriptor>>,
): EntityEntry {
  return { ...entry, descriptor: { ...entry.descriptor, fields } };
}
