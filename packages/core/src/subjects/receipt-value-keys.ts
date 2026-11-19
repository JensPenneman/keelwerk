import type { AnyField } from '../fields/field-def.ts';
import { parseSealedValueText } from '../keys/parse-sealed-value-text.ts';
import { sealedTextsOf } from '../keys/sealed-texts-of.ts';
import type { Registry } from '../registry/registry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';

/**
 * The ids of the value keys that the secret members of the purged receipts' `outcome.value` were
 * sealed under (`sealCommandOutput`: entity `core.commandReceipt`, the receipt's command id, the
 * field `outcome.<member>`). A text counts only when it opens against that binding. An outcome
 * without `value`, an action the registry no longer holds, and a `{ ref }` member name none.
 */
export async function receiptValueKeys(
  unit: Unit,
  registry: Registry,
  rows: readonly StorageRow[],
): Promise<readonly string[]> {
  const keyIds = new Set<string>();
  for (const row of rows) {
    if (typeof row.commandId !== 'string' || typeof row.action !== 'string') continue;
    const { outcome } = row;
    if (typeof outcome !== 'object' || outcome === null || !('value' in outcome)) continue;
    const { value } = outcome;
    if (typeof value !== 'object' || value === null) continue;
    const { fields } = (registry.actions.get(row.action)?.output ?? {}) as {
      readonly fields?: Readonly<Record<string, AnyField>>;
    };
    if (fields === undefined) continue;
    const stored = value as Readonly<Record<string, unknown>>;
    for (const [name, field] of Object.entries(fields)) {
      if (!Object.hasOwn(stored, name)) continue;
      for (const text of sealedTextsOf(field, stored[name])) {
        const sealed = parseSealedValueText(text);
        if (sealed === undefined) continue;
        const opened = await unit.keys.openValue(sealed, {
          entity: 'core.commandReceipt',
          id: row.commandId,
          field: `outcome.${name}`,
        });
        if (opened !== undefined) keyIds.add(sealed.keyId);
      }
    }
  }
  return [...keyIds];
}
