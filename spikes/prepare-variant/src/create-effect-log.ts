import type { EffectRecord } from './effect-record.ts';

/** The effect records of a test, in the order they were written. */
export interface EffectLog {
  readonly records: EffectRecord[];
}

/** A fresh, empty log; each test makes its own. */
export function createEffectLog(): EffectLog {
  return { records: [] };
}
