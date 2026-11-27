import { parseSealedValueText } from '../keys/parse-sealed-value-text.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';

/** The `kwv1` texts a stored member holds: the text itself, or each one in a list or set, however deep. */
function textsOf(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.flatMap(textsOf) : [];
}

/**
 * The value keys that the secret members of an effect's stored input or output were sealed under,
 * found from what is stored and never from the build's present shape (a deploy may have changed or
 * removed the shape or the type): every sealed text of a stored member is tried under the
 * effect's own binding of that member, and only a text that opens counts. A text moved in from
 * another row, member or effect, a reference loaded from another document and a key destroyed
 * before name nothing.
 */
export async function effectSecretKeys(
  unit: Unit,
  row: StorageRow,
  side: 'input' | 'output',
): Promise<readonly string[]> {
  const stored = row[side];
  if (typeof stored !== 'object' || stored === null) return [];
  const keyIds = new Set<string>();
  for (const [name, value] of Object.entries(stored)) {
    for (const text of textsOf(value)) {
      const sealed = parseSealedValueText(text);
      if (sealed === undefined) continue;
      const field = side === 'input' ? name : `output.${name}`;
      const binding = { entity: 'core.effect', id: String(row.id), field };
      if ((await unit.keys.openValue(sealed, binding)) !== undefined) keyIds.add(sealed.keyId);
    }
  }
  return [...keyIds];
}
