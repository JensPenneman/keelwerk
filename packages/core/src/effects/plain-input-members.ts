import type { AnyField } from '../fields/field-def.ts';
import { holdsCredential } from '../keys/holds-credential.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import { effectDataSubject } from './effect-data-subject.ts';

/**
 * The input members of an effect that hold no sealed value: not personal (`effectDataSubject`), not
 * secret or verifier, nor a list or set of such. A record keeps these in plaintext (S-166), so an
 * outside performer may read and filter by them; every other member reaches the performer only
 * through the owning module's own entities.
 */
export function plainInputMembers(entry: EffectEntry): readonly string[] {
  const { fields } = entry.input as { readonly fields?: Readonly<Record<string, AnyField>> };
  if (fields === undefined) return [];
  return Object.entries(fields)
    .filter(([, field]) => effectDataSubject(entry, field) === undefined && !holdsCredential(field))
    .map(([name]) => name);
}
