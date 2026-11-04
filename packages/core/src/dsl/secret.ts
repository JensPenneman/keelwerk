import type { SecretRef } from '../ids/secret-ref.ts';

/**
 * `secret('KEELWERK_MASTER_KEY')`: a reference to a value the deployment's secret providers
 * hold. The reference names the secret; the value is read through the resolver at boot.
 */
export function secret(name: string): SecretRef {
  return { ref: name } as SecretRef;
}
