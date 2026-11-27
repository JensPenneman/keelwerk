import type { AnyField } from '../fields/field-def.ts';
import { parseSealedValueText } from '../keys/parse-sealed-value-text.ts';
import { sealedTextsOf } from '../keys/sealed-texts-of.ts';
import type { Unit } from '../storage/unit.ts';

/**
 * The ids of the value keys that the secret members of `stored` were sealed under, for a document
 * bound as `entity`, `id` and member names behind `prefix`. A text counts only when it opens
 * against that binding, so a member that holds another document's text, or a key that was
 * destroyed before, names nothing. A `{ ref }` member names a key of the document it was loaded
 * from and is never touched.
 */
export async function sealedMemberKeys(
  unit: Unit,
  fields: Readonly<Record<string, AnyField>> | undefined,
  stored: unknown,
  binding: { readonly entity: string; readonly id: string; readonly prefix: string },
): Promise<readonly string[]> {
  if (fields === undefined || typeof stored !== 'object' || stored === null) return [];
  const members = stored as Readonly<Record<string, unknown>>;
  const keyIds = new Set<string>();
  for (const [name, field] of Object.entries(fields)) {
    if (!Object.hasOwn(members, name)) continue;
    for (const text of sealedTextsOf(field, members[name])) {
      const sealed = parseSealedValueText(text);
      if (sealed === undefined) continue;
      const opened = await unit.keys.openValue(sealed, {
        entity: binding.entity,
        id: binding.id,
        field: binding.prefix + name,
      });
      if (opened !== undefined) keyIds.add(sealed.keyId);
    }
  }
  return [...keyIds];
}
