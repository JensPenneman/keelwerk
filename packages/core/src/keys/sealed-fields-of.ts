import type { EntityEntry } from '../registry/entity-entry.ts';

/** The names of the entity's credential fields, `field.secret()` and `field.verifier()`, which are sealed per value (14.7.4). */
export function sealedFieldsOf(entry: EntityEntry): readonly string[] {
  return Object.entries(entry.descriptor.fields)
    .filter(([, field]) => field.kind === 'secret' || field.kind === 'verifier')
    .map(([name]) => name);
}
