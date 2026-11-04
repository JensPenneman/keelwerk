import type { Empty } from '../types/empty.ts';

/** The condition declarations of a module base. */
export type ConditionsOf<B> = B extends { readonly conditions: infer C } ? C : Empty;
