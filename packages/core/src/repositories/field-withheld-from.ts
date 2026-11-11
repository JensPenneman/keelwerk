import type { EntityEntry } from '../registry/entity-entry.ts';

/**
 * Whether a field of an entity is withheld from the part of the module `authority` (section 14.8.1,
 * 6.6): the one rule that decides what a module sees of a row and of the payload of an event. A
 * field another module contributed to the entity belongs to that contributor alone. A hidden,
 * secret or verifier field belongs to its owner (the contributor, else the entity's module) alone.
 * A name that is no field of the entity is not withheld here (a row carries such members); the payload
 * of an event is stricter: `reactionPayloadOf` hands a name that is no field to the entity's module only.
 */
export function fieldWithheldFrom(entry: EntityEntry, field: string, authority: string): boolean {
  const descriptor = entry.descriptor.fields[field];
  if (descriptor === undefined) return false;
  const contributor = entry.origin[field];
  if (contributor !== undefined && contributor !== authority) return true;
  const owner = contributor ?? entry.module;
  return (
    (descriptor.hidden !== false ||
      descriptor.kind === 'verifier' ||
      descriptor.kind === 'secret') &&
    owner !== authority
  );
}
