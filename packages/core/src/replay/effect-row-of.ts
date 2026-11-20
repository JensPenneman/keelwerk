import { errors } from '../errors/errors.ts';
import type { Registry } from '../registry/registry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';

/** The `core.effect` row of an effect id in the unit's scope, or `undefined` when the table holds none. */
export async function effectRowOf(
  unit: Unit,
  registry: Registry,
  effectId: string,
): Promise<StorageRow | undefined> {
  const descriptor = registry.entities.get('core.effect')?.descriptor;
  if (descriptor === undefined) throw errors.internal('the app has no core.effect entity');
  return unit.rows.findOne(descriptor, { where: { op: 'eq', field: 'id', value: effectId } });
}
