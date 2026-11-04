import type { EffectOutcome } from '../model/effect-outcome.ts';
import type { SettleEffect } from '../protocol/settle-effect.ts';

/** Settles an effect with an external performer: the `settled` record and its continuation (section 7.9.5). */
export function settle<O>(effect: string, outcome: EffectOutcome<O>): SettleEffect {
  return Object.freeze({ kind: 'settle', type: 'settle', effect, outcome });
}
