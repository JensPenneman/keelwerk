import type { ExtensionPoint } from '../dsl/extension-point.ts';

/** The value a module reads from one of its own extension points: a `single` point reads as `T` (`T | undefined` when declared with `min: 0`), the others as a list. */
export type ExtensionValue<X> =
  X extends ExtensionPoint<infer T, infer M, infer O>
    ? M extends 'single'
      ? O extends true
        ? T | undefined
        : T
      : readonly T[]
    : never;

/** What a contributor fills into a point: one value for `single`, a value or a list otherwise. */
export type FillValue<X> =
  X extends ExtensionPoint<infer T, infer M, boolean>
    ? M extends 'single'
      ? T
      : T | readonly T[]
    : never;
