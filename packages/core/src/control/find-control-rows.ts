import type { ConditionInput } from '../conditions/condition-input.ts';
import { normalizeCondition } from '../conditions/normalize-condition.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { ControlStore } from './control-store.ts';

/** The live rows of a core entity that match `where`, read in one deployment-scope unit. */
export function findControlRows(
  store: ControlStore,
  ref: string,
  where: ConditionInput,
): Promise<readonly StorageRow[]> {
  const entity = store.entity(ref);
  return store.read(async (unit) => {
    const page = await unit.rows.find(entity, { where: normalizeCondition(where) });
    return page.rows;
  });
}
