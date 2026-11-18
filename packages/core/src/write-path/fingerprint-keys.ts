import type { Unit } from '../storage/unit.ts';

/**
 * Where the personal members of an input are digested; `null` in its place means the 0.1.0 form.
 */
export interface FingerprintKeys {
  /**
   * The unit the fingerprint is computed in: the subject of a member and its data key live there.
   */
  readonly unit: Unit;
  /**
   * True on a write (the subject's key is created when absent); false on a re-decide and on the
   * record of a failed receipt, which only read.
   */
  readonly create: boolean;
}
