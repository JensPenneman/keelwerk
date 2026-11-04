import type { LeafAt } from './leaf-at.ts';

/** The item a subscription emits. */
export type EventOf<App, R> = LeafAt<App, R> extends { readonly events: infer E } ? E : never;
