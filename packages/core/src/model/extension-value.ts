import type { ExtensionPoint } from '../dsl/extension-point.ts';

/** The value a module reads from one of its own extension points: a `single` point reads as `T`, the others as a list. */
export type ExtensionValue<X> =
  X extends ExtensionPoint<infer T, infer M> ? (M extends 'single' ? T : readonly T[]) : never;

/** What a contributor fills into a point: one value for `single`, a value or a list otherwise. */
export type FillValue<X> =
  X extends ExtensionPoint<infer T, infer M> ? (M extends 'single' ? T : T | readonly T[]) : never;
