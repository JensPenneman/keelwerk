import type { KeelwerkError } from '@keelwerk/core';
import type { LeafAt } from './leaf-at.ts';

/** A declared error with its code as a literal and its details in the in-process form of the data schema. */
export type DeclaredError<Code extends string, Details> = KeelwerkError & {
  readonly code: Code;
  readonly details: Details;
};

/** The errors an action declares, one member per `{ code, data }` of its leaf in the action tree. */
export type DeclaredErrorOf<App, R> =
  LeafAt<App, R> extends { readonly errors: infer E }
    ? E extends { readonly code: infer C extends string; readonly data: infer D }
      ? DeclaredError<C, D>
      : never
    : never;
