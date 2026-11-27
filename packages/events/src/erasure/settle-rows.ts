import type { ErasureRecord, Registry, Unit } from '@keelwerk/core';
import { erasePrincipals, isPrincipalValueKeyId, scrubReceiptFingerprints } from '@keelwerk/core';
import type { Settled } from './settled.ts';

/**
 * What follows from the row answers, in one writing tenant unit that holds no row's lock: the
 * purge of the principal that an owned row's id stands for (receipts, jobs, stream tickets,
 * request-rate buckets and the key its request records are sealed under), of the receipts of the
 * commands that wrote in an owned row, and the erased fingerprint of the receipts that stay, for
 * the commands that wrote in any of the rows. A unit that holds a row's lock and then waits for a
 * receipt would meet a command that holds the receipt and waits for the row.
 */
export async function settleRows(
  unit: Unit,
  input: {
    readonly registry: Registry;
    readonly record: Pick<ErasureRecord, 'commandId'>;
    readonly rows: readonly Settled[];
    readonly rateBuckets: readonly string[];
    readonly onValueKeys: (keyIds: readonly string[]) => Promise<void>;
  },
): Promise<void> {
  const ids: string[] = [];
  const commandIds = new Set<string>();
  const ownedCommandIds = new Set<string>();
  // The value key each request record of a command with no principal id is sealed under.
  const requestKeys = new Set<string>();
  for (const { stream, owned } of input.rows) {
    if (owned) ids.push(stream.id);
    for (const event of await unit.events.readStream(stream)) {
      // The erasure's own receipt is completed last, by step 6.
      if (event.commandId === null || event.commandId === input.record.commandId) continue;
      commandIds.add(event.commandId);
      if (!owned) continue;
      ownedCommandIds.add(event.commandId);
      // A request record under the subject's data key goes with the shred, one under a principal
      // id's key with the id; one under a key of its own is destroyed here.
      const request = event.decision?.request;
      if (request !== undefined && !('$kwe' in request) && !isPrincipalValueKeyId(request.keyId)) {
        requestKeys.add(request.keyId);
      }
    }
  }
  if (ids.length > 0) {
    await erasePrincipals(unit, input.registry, ids, [...ownedCommandIds], {
      onValueKeys: input.onValueKeys,
      commandRequestKeys: [...requestKeys],
      rateBuckets: input.rateBuckets,
    });
  }
  await scrubReceiptFingerprints(unit, input.registry, [...commandIds]);
}
