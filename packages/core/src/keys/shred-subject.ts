import { errors } from '../errors/errors.ts';
import type { KeyService } from '../kernel/key-service.ts';
import type { KeyTombstoneRecord } from '../ledger/key-tombstone-record.ts';
import type { Unit } from '../storage/unit.ts';
import { canonicalSubject } from '../subjects/canonical-subject.ts';
import { decoySubject } from './decoy-subject.ts';

/**
 * Shreds the subject's data keys in `unit` (a writing tenant unit) and drops the scope's cached
 * keys. Answers one `keyTombstone` per data key the subject has that is destroyed, destroyed now or
 * before (`shreddedKeys`), so a repeat gives the same key ids: a crash between the shred and the
 * ledger append is repaired by running the step again (14.7.5). Value keys of owned rows go with the
 * rows (`eraseStream`); index keys do not exist per subject yet. The reserved decoy subject is never
 * shredded (`internal`): its key makes the lookup of an absent API key cost what a found one does.
 */
export async function shredSubject(
  unit: Unit,
  keys: KeyService,
  subjectId: string,
  at: Temporal.Instant,
): Promise<readonly KeyTombstoneRecord[]> {
  const { scope } = unit;
  if (canonicalSubject(subjectId) === canonicalSubject(decoySubject)) {
    throw errors.internal('The reserved decoy subject is never shredded.');
  }
  if (scope.level !== 'tenant') throw errors.internal('A subject is shredded in a tenant unit.');
  await unit.keys.shred(subjectId);
  const shredded = await unit.keys.shreddedKeys(subjectId);
  keys.invalidate(scope);
  return shredded.map(
    ({ keyId }): KeyTombstoneRecord => ({
      type: 'keyTombstone',
      scopeId: scope.tenantId,
      keyId,
      recordedAt: at.toString(),
      reason: 'erasure',
    }),
  );
}
