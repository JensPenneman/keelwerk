import type { BaseOf } from '../model/part-source.ts';

/** 'all' when the base declares `observes: 'all'` (G12): the only base whose reactions may say `on: 'all'`. */
export type Observes<S> = BaseOf<S> extends { readonly observes: 'all' } ? 'all' : never;
