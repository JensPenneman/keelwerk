import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import { ownedRows } from './owned-rows.ts';

/**
 * Whether a module holds a live row of this subject in the unit's tenant: a row of one of its
 * tenant entities that has a data subject and whose data subject is `subjectId`, found by the
 * lookup an erasure uses (`ownedRows`), so a row that holds no personal value counts. An erased row
 * never counts (a tombstone is invisible to a read), so an erased subject is owned by nobody.
 */
export async function ownsSubject(
  unit: Unit,
  registry: Registry,
  module: string,
  subjectId: string,
): Promise<boolean> {
  const page = await ownedRows(unit, {
    registry,
    subjectId,
    module,
    includeErased: false,
    after: null,
    limit: 1,
  });
  return page.rows.length > 0;
}
