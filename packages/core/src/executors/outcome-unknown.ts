import type { EffectAttemptError } from '../effects/effect-attempt-error.ts';

/**
 * Whether an attempt that did not succeed leaves the destination's outcome unknown (7.9.5): the
 * executor returned and the kernel could not take the answer (`acted`), or the attempt ran out of
 * `expireInSeconds` and the policy does not run it again (`retried` false), so nobody will learn
 * whether the destination acted. A timeout that is retried is a retry of the same effect. A
 * timeout is a plain failure only when no attempt's executor was ever called: this attempt's
 * timeout fired before its executor was called (`unrun`) and no earlier take of the effect began
 * (`earlier`), since an earlier attempt may have reached the destination.
 */
export function outcomeUnknown(
  acted: boolean,
  projection: EffectAttemptError,
  retried: boolean,
  unrun: boolean,
  earlier: boolean,
): boolean {
  return acted || (projection.code === 'core.timeout' && !retried && !(unrun && !earlier));
}
