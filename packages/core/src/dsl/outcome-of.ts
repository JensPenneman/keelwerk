import type { Shape } from '../fields/shape.ts';
import type { Empty } from '../types/empty.ts';
import type { AnyEffectPart } from './define-effect.ts';

/** The input of a continuation: the outcome of `effect`, and the extra input its `with` carries (section 7.9.5). */
export interface OutcomeShape<O, X extends Shape = Shape<Empty>> {
  readonly kind: 'outcome';
  readonly effect: AnyEffectPart;
  readonly extra?: X;
  readonly '~output'?: O;
}

/** Types a continuation's input by the effect's outcome (decision 97's `continueWith`), plus an optional shape for `with`. */
export function outcomeOf<const E extends AnyEffectPart, const X extends Shape = Shape<Empty>>(
  effect: E,
  extra?: X,
): OutcomeShape<NonNullable<E['~types']>['output'], X> {
  return extra === undefined ? { kind: 'outcome', effect } : { kind: 'outcome', effect, extra };
}
