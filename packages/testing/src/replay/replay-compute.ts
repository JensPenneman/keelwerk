import type { ComputePool } from '@keelwerk/core';
import { errors } from '@keelwerk/core';

const refusal = () => Promise.reject(errors.unsupported('A re-decide has no compute pool.'));

/** Computations are not part of a re-decide: every call says so instead of answering. */
export const replayCompute: ComputePool = {
  argon2idHash: refusal,
  argon2idVerify: refusal,
  close: async () => undefined,
};
