import { sealedFieldsOf } from '../keys/sealed-fields-of.ts';
import type { FingerprintSource } from './command-digests.ts';
import { inputFingerprint } from './input-fingerprint.ts';
import { keyedInputFingerprint } from './keyed-input-fingerprint.ts';

/**
 * Whether the command's input carries a member the control path sealed or its entity seals per
 * value.
 */
function carriesSecrets(source: FingerprintSource): boolean {
  if (source.fingerprintInput !== undefined) return true;
  const { action, input } = source;
  if (action.entity === undefined || typeof input !== 'object' || input === null) return false;
  const entry = source.registry.entities.get(action.entity);
  if (entry === undefined) return false;
  return sealedFieldsOf(entry).some((field) => Reflect.get(input, field) !== undefined);
}

/**
 * The 0.1.0 form of a command's fingerprint: keyed under `fingerprintKey` iff `fingerprintInput` is
 * set or an entity-bound action's input names a sealed field of its entity at top level, the plain
 * sha256 otherwise; over the unmasked `fingerprintInput ?? input`; the empty version for a
 * reaction's job. Bit for bit what 0.1.0 wrote (64 bare hex characters, secrets inside): it is
 * computed only to compare a stored text of that form, never written.
 */
export function legacyFingerprint(source: FingerprintSource): string {
  const version = source.job?.reaction === true ? '' : source.apiVersion;
  const input = source.fingerprintInput ?? source.input;
  const { action } = source;
  return carriesSecrets(source)
    ? keyedInputFingerprint(source.fingerprintKey, action.ref, version, input)
    : inputFingerprint(action.ref, version, input);
}
