import type { LeafAt } from './leaf-at.ts';

/** The in-process input of an action: `Temporal` values and `bigint` stay as they are. */
export type InputOf<App, R> = LeafAt<App, R> extends { readonly input: infer I } ? I : never;
