/**
 * The codes only the kernel stores as the outcome of an effect: a deadline, an attempt that may
 * have acted, a lost lease, an erased subject. An outside performer's failed settle never carries
 * one of them, so a continuation can tell the kernel's outcome from a performer's claim.
 */
export const kernelOnlyErrorCodes: readonly string[] = Object.freeze([
  'core.effect_deadline',
  'core.effect_outcome_unknown',
  'core.job_lease_lost',
  'core.key_destroyed',
]);
