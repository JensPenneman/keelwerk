import type { Fact } from './fact.ts';

/** A fact doctor cannot get, with the reason and the fix that are printed in its place. */
export function absent<T>(reason: string, fix: string): Fact<T> {
  return { known: false, reason, fix };
}
