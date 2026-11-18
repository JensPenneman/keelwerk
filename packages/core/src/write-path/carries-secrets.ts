import { sealedFieldsOf } from '../keys/sealed-fields-of.ts';
import type { FingerprintSource } from './command-fingerprint.ts';

/**
 * Whether the command's input carries a member the control path sealed or its entity seals per
 * value.
 */
export function carriesSecrets(source: FingerprintSource): boolean {
  if (source.fingerprintInput !== undefined) return true;
  const { action, input } = source;
  if (action.entity === undefined || typeof input !== 'object' || input === null) return false;
  const entry = source.registry.entities.get(action.entity);
  if (entry === undefined) return false;
  return sealedFieldsOf(entry).some((field) => Reflect.get(input, field) !== undefined);
}
