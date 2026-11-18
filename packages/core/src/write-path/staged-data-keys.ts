import { sealedKeyIds } from '../encryption/sealed-key-ids.ts';
import type { DataKey } from '../storage/data-key.ts';
import type { Unit } from '../storage/unit.ts';
import type { StagedEvent } from './staged-event.ts';

/**
 * The data keys of the `$kwe` envelopes in `data` and `before` of the staged events that are
 * chain-hashed (a transient record is not part of the decision), in first-seen order. A key the
 * unit no longer holds is left out: the decision digest is keyed under the keys that exist.
 */
export async function stagedDataKeys(
  unit: Unit,
  staged: readonly StagedEvent[],
): Promise<readonly DataKey[]> {
  const ids = new Set<string>();
  for (const item of staged) {
    if (item.transient) continue;
    for (const id of sealedKeyIds(item.data)) ids.add(id);
    for (const id of sealedKeyIds(item.before)) ids.add(id);
  }
  const keys: DataKey[] = [];
  for (const id of ids) {
    const key = await unit.keys.keyById(id);
    if (key !== undefined) keys.push(key);
  }
  return keys;
}
