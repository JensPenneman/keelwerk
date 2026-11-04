import type { ComputeRequest } from '../protocol/compute-request.ts';

/** Computations of the core, answered off the event loop. */
export interface CoreComputations {
  argon2idHash(password: string, salt: Uint8Array): ComputeRequest<string>;
  argon2idVerify(verifier: string, password: string): ComputeRequest<boolean>;
}
