import type { SecretRef } from '../ids/secret-ref.ts';

/** One source of secret values (the environment, later vault modules); the resolver asks them in deployment order. */
export interface SecretProvider {
  readonly id: string;
  /** The value, or undefined when this provider does not hold the reference. */
  resolve(ref: SecretRef): Promise<string | undefined>;
}
