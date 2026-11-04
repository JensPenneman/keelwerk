import type { Shape } from './shape.ts';
import type { ShapeValue } from './shape-value.ts';

/** A module's configuration as handlers read it: defaults applied, secrets as references (section 5.7). */
export type ConfigOf<B> = B extends {
  readonly config: Shape<infer F>;
  readonly id: infer I extends string;
}
  ? ShapeValue<F, I, 'stored'>
  : {};
