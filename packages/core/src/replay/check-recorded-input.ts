import { errors } from '../errors/errors.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import type { Unit } from '../storage/unit.ts';
import { commandDigests, type FingerprintSource } from '../write-path/command-digests.ts';
import { decisionBasePrefix } from '../write-path/decision-base-prefix.ts';
import { decisionDigestPrefix } from '../write-path/decision-digest-prefix.ts';
import { isLegacyDigest } from '../write-path/is-legacy-digest.ts';
import { recordedDecisionDigest } from './recorded-decision-digest.ts';

/**
 * Refuses, as `validation`, an input that is not the one a decision recorded. A decision base
 * (`kwb1.`) or its rekey (`kwd1.`) is compared with the decision base of the supplied input,
 * rekeyed as the decision was (the data keys of the personal values it sealed;
 * `core.replay_key_destroyed` when one is gone): the secret, verifier and personal members of the
 * supplied input are not checked. A digest in the 0.1.0 form (64 bare hex characters) is compared
 * with the 0.1.0 fingerprint of the supplied input, secrets included. Any other text cannot be
 * checked.
 */
export async function checkRecordedInput(
  unit: Unit,
  source: FingerprintSource,
  events: readonly StoredEvent[],
  recorded: string,
): Promise<void> {
  const digests = commandDigests(source);
  if (recorded.startsWith(decisionBasePrefix) || recorded.startsWith(decisionDigestPrefix)) {
    const expected = await recordedDecisionDigest(
      unit,
      source.registry,
      events,
      digests.decisionBase,
    );
    if (expected !== recorded) {
      throw errors.validation('The input is not the one the decision recorded.');
    }
    return;
  }
  if (isLegacyDigest(recorded) && digests.legacyFingerprint() === recorded) return;
  throw errors.validation(
    'The input is not the one the decision recorded. A digest in the 0.1.0 form covers every member, secrets included; a digest written by a build between 0.1.0 and 0.2.0 that keyed a personal member cannot be checked.',
  );
}
