import type { Empty } from '../types/empty.ts';

/** The entities of a module base or module value. */
export type EntitiesOf<M> = M extends { readonly entities: infer Es } ? Es : Empty;

/** The entity names of a module base or module value. */
export type EntityNames<M> = keyof EntitiesOf<M> & string;

/** One entity of a module base or module value, `never` when it does not exist. */
export type EntityAt<M, E> = E extends keyof EntitiesOf<M> ? EntitiesOf<M>[E] : never;
