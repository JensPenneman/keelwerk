import type { Registry, Unit } from '@keelwerk/core';
import { erasePrincipals } from '@keelwerk/core';
import type { KnownKeys } from './tombstone-recorder.ts';
import { untilTombstoned } from './until-tombstoned.ts';

/**
 * Step 5a of section 14.7.5 at the backend scope, for the ids of rows that the erasure erased as
 * the subject's own: the principal an id stands for may have acted in the backend scope of the
 * tenant, where its request records, receipts and jobs are kept under that id. One writing unit of
 * the backend scope purges them, tombstones first (`untilTombstoned`: a key the unit read that has
 * no tombstone in the backend scope rolls it back, `record` appends the missing ones and the unit
 * runs again). The unit destroys only the keys it read in its own transaction: a principal key that
 * a command seals under for the first time and commits after that read is not destroyed and keeps
 * its record. The subject's own spellings are never given here: the same person may live in
 * another tenant of the backend.
 */
export async function purgeBackendPrincipals(input: {
  readonly registry: Registry;
  readonly rowIds: readonly string[];
  readonly known: KnownKeys;
  readonly record: (keyIds: readonly string[]) => Promise<void>;
  readonly unit: <T>(fn: (unit: Unit) => Promise<T>) => Promise<T>;
  readonly inside: () => Promise<void>;
}): Promise<void> {
  const { registry, rowIds, known, record, unit, inside } = input;
  await untilTombstoned(known, record, (gate) =>
    unit(async (u) => {
      await inside();
      await erasePrincipals(u, registry, rowIds, [], { onValueKeys: gate.onValueKeys });
      gate.check();
    }),
  );
}
