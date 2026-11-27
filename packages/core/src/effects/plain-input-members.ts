import type { AnyField } from '../fields/field-def.ts';
import { hidesMemberAt } from '../fields/hides-member-at.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';

/**
 * The input members of an effect that hold no sealed value: not personal, not
 * secret or verifier, nor a list or set of such (`hidesMemberAt`). A record keeps these in plaintext (S-166), so an
 * outside performer may read and filter by them; every other member reaches the performer only
 * through the owning module's own entities.
 */
export function plainInputMembers(entry: EffectEntry): readonly string[] {
  const { fields } = entry.input as { readonly fields?: Readonly<Record<string, AnyField>> };
  if (fields === undefined) return [];
  return Object.entries(fields)
    .filter(([, field]) => !hidesMemberAt('effectInput', field))
    .map(([name]) => name);
}
