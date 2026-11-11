import type { LiveView, StorageRow, Unit } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { planGroups } from './plan-groups.ts';

/**
 * The verdicts of one batch: per distinct plan, the post-images the plan selects, masked and presented
 * (15.2.5). Each plan is evaluated once, whatever the number of subscribers behind it. `expired`
 * throws when the pass is past its deadline.
 */
export async function planVerdicts(
  unit: Unit,
  expired: () => void,
  views: readonly LiveView[],
  rows: ReadonlyMap<string, ReadonlyMap<string, StorageRow | undefined>>,
): Promise<Map<string, ReadonlyMap<string, StorageRow>>> {
  const verdicts = new Map<string, ReadonlyMap<string, StorageRow>>();
  for (const [key, group] of planGroups(views)) {
    const found = rows.get(group.entity);
    const present = [...(found?.values() ?? [])].filter(
      (row): row is StorageRow => row !== undefined,
    );
    if (present.length === 0) continue;
    const selects = await group.view.inPlan(unit, present);
    expired();
    const selected = present.filter((_, index) => selects[index] === true);
    const shown = selected.length === 0 ? [] : await group.view.present(unit, selected);
    expired();
    if (shown.length !== selected.length) {
      throw errors.internal('A presented batch has another size than the rows it was made from.');
    }
    verdicts.set(
      key,
      new Map(
        selected.flatMap((row, index) => {
          const one = shown[index];
          return one === undefined ? [] : [[String(row.id), one] as const];
        }),
      ),
    );
  }
  return verdicts;
}
