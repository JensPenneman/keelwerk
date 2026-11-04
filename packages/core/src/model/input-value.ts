import type { OutcomeShape } from '../dsl/outcome-of.ts';
import type { Shape } from '../fields/shape.ts';
import type { ShapeValue } from '../fields/shape-value.ts';
import type { Empty } from '../types/empty.ts';
import type { EffectOutcome } from './effect-outcome.ts';

/** The input value a handler receives. */
export type InputValue<In, Owner extends string> =
  In extends Shape<infer F>
    ? ShapeValue<F, Owner, 'input'>
    : In extends OutcomeShape<infer O, infer X>
      ? { readonly outcome: EffectOutcome<O> } & (X extends Shape<infer Fields>
          ? ShapeValue<Fields, Owner, 'input'>
          : Empty)
      : Empty;
