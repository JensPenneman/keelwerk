import { argon2idHash } from './argon2id-hash.ts';
import { argon2idVerify } from './argon2id-verify.ts';

/** One computation sent to a pool worker. */
export type Argon2idJob =
  | {
      readonly id: number;
      readonly op: 'hash';
      readonly password: string;
      readonly salt: Uint8Array;
    }
  | {
      readonly id: number;
      readonly op: 'verify';
      readonly password: string;
      readonly verifier: string;
    };

/** A worker's answer: the hash or the verdict, or the failure's message. */
export type Argon2idJobResult =
  | { readonly id: number; readonly ok: true; readonly value: string | boolean }
  | { readonly id: number; readonly ok: false; readonly message: string };

/** Runs one job on the calling thread; the worker's whole behaviour. */
export function runArgon2idJob(job: Argon2idJob): Argon2idJobResult {
  try {
    return {
      id: job.id,
      ok: true,
      value:
        job.op === 'hash'
          ? argon2idHash(job.password, job.salt)
          : argon2idVerify(job.verifier, job.password),
    };
  } catch (error) {
    return { id: job.id, ok: false, message: error instanceof Error ? error.message : 'failed' };
  }
}
