import type { Registry, Unit } from '@keelwerk/core';
import { openRecordedKeys } from '@keelwerk/core';

/**
 * Destroys the keys of `keyIds` that still open and were not made for a row of an app entity (a
 * job, a command's decision, an effect record, a receipt): a job that turned running after its key
 * was tombstoned was kept by the purge. The key of a row is never swept: its row went through the
 * erasure's visit before, and only the unit that erases a row destroys its key, once it has read
 * under the row's lock whose row it is. `onValueKeys` sees the keys first, for their tombstones.
 */
export async function destroyRecorded(
  unit: Unit,
  input: {
    readonly registry: Registry;
    readonly keyIds: readonly string[];
    readonly pageSize: number;
    readonly onValueKeys: (keyIds: readonly string[]) => Promise<void>;
  },
): Promise<void> {
  for (let at = 0; at < input.keyIds.length; at += input.pageSize) {
    const { sweepable } = await openRecordedKeys(
      unit,
      input.registry,
      input.keyIds.slice(at, at + input.pageSize),
    );
    await input.onValueKeys(sweepable);
    for (const keyId of sweepable) await unit.keys.destroyValueKey(keyId);
  }
}
