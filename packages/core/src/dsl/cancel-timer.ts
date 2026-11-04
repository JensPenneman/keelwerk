import type { CancelTimerEffect } from '../protocol/cancel-timer-effect.ts';

/** Cancels the keyed timer `key` (section 9.5.1). */
export function cancelTimer(key: string): CancelTimerEffect {
  return Object.freeze({ kind: 'cancelTimer', type: 'cancelTimer', key });
}
