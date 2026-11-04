import type { SecretRef } from '../ids/secret-ref.ts';

/** Resolves secret references through the deployment's secret providers, in order. */
export interface SecretResolver {
  /** `reason` is logged with the lookup. */
  resolve(ref: SecretRef, reason: string): Promise<string>;
}
