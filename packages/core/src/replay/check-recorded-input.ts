import { errors } from '../errors/errors.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import type { Unit } from '../storage/unit.ts';
import { commandFingerprint, type FingerprintSource } from '../write-path/command-fingerprint.ts';
import { PersonalKeyDestroyed } from '../write-path/personal-key-destroyed.ts';
import { recordedDecisionDigest } from './recorded-decision-digest.ts';
import { replayKeyDestroyed } from './replay-key-destroyed.ts';

/**
 * Refuses, as `validation`, an input that is not the one a decision recorded. The digest of 0.1.0
 * first (the plain fingerprint of the input); else the keyed one the current release writes, which
 * needs the data keys of the personal values the decision sealed (`core.replay_key_destroyed` when
 * one is gone).
 */
export async function checkRecordedInput(
  unit: Unit,
  source: FingerprintSource,
  events: readonly StoredEvent[],
  recorded: string,
): Promise<void> {
  if ((await commandFingerprint(source, null)) === recorded) return;
  let keyed: string;
  try {
    keyed = await commandFingerprint(source, { unit, create: false });
  } catch (error) {
    if (error instanceof PersonalKeyDestroyed) {
      throw replayKeyDestroyed('a personal value of the decision');
    }
    throw error;
  }
  if ((await recordedDecisionDigest(unit, source.registry, events, keyed)) !== recorded) {
    throw errors.validation('The input is not the one the decision recorded.');
  }
}
