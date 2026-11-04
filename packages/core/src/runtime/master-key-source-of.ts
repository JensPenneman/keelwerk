import { errors } from '../errors/errors.ts';
import type { SecretRef } from '../ids/secret-ref.ts';
import type { SecretResolver } from '../kernel/secret-resolver.ts';
import type { MasterKeySource } from '../keys/master-key-source.ts';

/**
 * The deployment master key from `keys.masterKey` (14.7.4): the secret holds 32 bytes in base64
 * (or 64 hexadecimal characters). Version 1 until a key-management module rotates it.
 */
export async function masterKeySourceOf(
  ref: SecretRef | undefined,
  secrets: SecretResolver,
): Promise<MasterKeySource> {
  if (ref === undefined) {
    throw errors.validation('The deployment has no keys.masterKey, which the key service needs.');
  }
  const text = (await secrets.resolve(ref, 'the deployment master key')).trim();
  const material = /^[0-9a-f]{64}$/i.test(text)
    ? Uint8Array.from(Buffer.from(text, 'hex'))
    : Uint8Array.from(Buffer.from(text, 'base64'));
  if (material.length !== 32) {
    throw errors.validation(
      'keys.masterKey must be 32 bytes, in base64 or 64 hexadecimal characters.',
    );
  }
  return {
    current: async () => ({ version: 1, material }),
    byVersion: async (version) => (version === 1 ? { version, material } : undefined),
  };
}
