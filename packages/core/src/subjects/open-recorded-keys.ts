import type { StreamRef } from '../events/stream-ref.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import { handledElsewhere } from './handled-elsewhere.ts';

/** The value keys of a list that still open, told apart by what they were made for. */
export interface OpenRecordedKeys {
  /**
   * The keys made for no row of an app entity: a job, a command's decision, an effect record, a
   * receipt, or an entity the registry does not hold. Nothing can change whose they are.
   */
  readonly sweepable: readonly string[];
  /** The rows the other keys were made for (the key record names its entity and row id), each once. */
  readonly rows: readonly StreamRef[];
}

/**
 * Of these value keys, the ones that still open, split into `sweepable` keys and the `rows` of an
 * app entity that the rest were made for. A row's key is destroyed only by the unit that erases
 * the row, after it read under the row's lock whose row it is, so a row goes there and its key
 * is not swept.
 */
export async function openRecordedKeys(
  unit: Unit,
  registry: Registry,
  keyIds: readonly string[],
): Promise<OpenRecordedKeys> {
  const sweepable: string[] = [];
  const rows = new Map<string, StreamRef>();
  for (const keyId of await unit.keys.liveValueKeys(keyIds)) {
    const binding = await unit.keys.valueKeyBinding(keyId);
    if (binding === undefined) continue;
    if (!registry.entities.has(binding.entity) || handledElsewhere.has(binding.entity)) {
      sweepable.push(keyId);
    } else {
      rows.set(`${binding.entity}\u0000${binding.id}`, { type: binding.entity, id: binding.id });
    }
  }
  return { sweepable, rows: [...rows.values()] };
}
