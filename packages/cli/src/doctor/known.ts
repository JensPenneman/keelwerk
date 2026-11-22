import type { Fact } from './fact.ts';

/** A fact doctor has. */
export function known<T>(value: T): Fact<T> {
  return { known: true, value };
}
