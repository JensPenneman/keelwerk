import type { Empty } from '../types/empty.ts';

/** The contribution declarations of a module base. */
export type ContributionsOf<B> = B extends { readonly contributions: infer C } ? C : Empty;
