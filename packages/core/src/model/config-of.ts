import type { Shape } from '../fields/shape.ts';
import type { ShapeValue } from '../fields/shape-value.ts';
import type { Empty } from '../types/empty.ts';

/** A module's configuration as handlers read it: defaults applied, secrets as references (section 5.7). */
export type ConfigOf<B> = B extends {
  readonly config: Shape<infer F>;
  readonly id: infer I extends string;
}
  ? ShapeValue<F, I, 'stored'>
  : Empty;
