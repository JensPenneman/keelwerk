import type { Argon2idParams } from './argon2id-params.ts';
import { argon2idParams } from './argon2id-params.ts';
import { parseArgon2idHash } from './parse-argon2id-hash.ts';

/** Whether a stored hash was written with other parameters than `current`, or is malformed: a successful login then rehashes (17.2.2). */
export function needsRehash(phc: string, current: Argon2idParams = argon2idParams): boolean {
  const parsed = parseArgon2idHash(phc);
  if (parsed === undefined) return true;
  const { params } = parsed;
  return (
    params.memoryKib !== current.memoryKib ||
    params.passes !== current.passes ||
    params.parallelism !== current.parallelism ||
    params.tagLength !== current.tagLength
  );
}
