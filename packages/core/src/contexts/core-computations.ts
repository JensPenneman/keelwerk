import type { ComputeRequest } from '../protocol/compute-request.ts';

/** Computations of the core, answered off the event loop. */
export interface CoreComputations {
  argon2idHash(password: string, salt: Uint8Array): ComputeRequest<string>;
  argon2idVerify(verifier: string, password: string): ComputeRequest<boolean>;
  /** Whether a stored verifier (sealed text from a row, or the encoded hash) was written with other parameters than the current ones: a login then rehashes (17.2.2). */
  argon2idNeedsRehash(verifier: string): ComputeRequest<boolean>;
}
