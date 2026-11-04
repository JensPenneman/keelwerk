import type { AnyEffect } from './define-effect.ts';

/** The input of a continuation: the outcome of `effect` (section 7.9.5). */
export interface OutcomeShape<O> {
  readonly kind: 'outcome';
  readonly effect: AnyEffect;
  readonly '~output'?: O;
}

/** Types a continuation's input by the effect's outcome. */
export function outcomeOf<const E extends AnyEffect>(
  effect: E,
): OutcomeShape<NonNullable<E['~types']>['output']> {
  return { kind: 'outcome', effect };
}
