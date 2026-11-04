import type { OutcomeShape } from '../dsl/outcome-of.ts';
import type { Shape } from '../fields/shape.ts';

/** What `input` accepts: a shape, or `outcomeOf(effect)` for continuations. */
export type InputSpec = Shape | OutcomeShape<unknown, Shape>;
