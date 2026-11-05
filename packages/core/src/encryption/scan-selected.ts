import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { RowPage } from '../storage/row-page.ts';
import type { RowQuery } from '../storage/row-query.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { openRow } from './open-row.ts';
import type { PlannedCondition } from './planned-condition.ts';
import { scanCandidates } from './scan-candidates.ts';
import type { SealingContext } from './sealing-context.ts';
import { verifyUnsealed } from './verify-unsealed.ts';

/** The rows a bounded scan selects, unsealed and filtered by the original condition, in id order. */
export async function scanSelected(
  context: SealingContext,
  entity: EntityDescriptor,
  query: RowQuery,
  plan: PlannedCondition,
): Promise<{ rows: readonly StorageRow[]; position: RowPage['position'] }> {
  const found = await scanCandidates(context, entity, plan.condition, {
    ...(query.includeArchived === true ? { includeArchived: true } : {}),
    ...(query.forUpdate === true ? { forUpdate: true } : {}),
    ...(query.positioned === true ? { positioned: true } : {}),
  });
  const opened: StorageRow[] = [];
  for (const row of found.rows) opened.push(await openRow(context, entity, row));
  const original = query.where;
  return {
    rows: original === undefined ? opened : verifyUnsealed(context, entity, original, opened),
    position: found.position,
  };
}
