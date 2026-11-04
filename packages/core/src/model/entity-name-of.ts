import type { EntitiesOf } from './entities-of.ts';

/** The own entity values of a base. */
export type OwnEntityValue<B> = EntitiesOf<B>[keyof EntitiesOf<B>];

/** The name under which a base lists an entity value. */
export type EntityNameOf<B, En> = {
  [K in keyof EntitiesOf<B>]: [EntitiesOf<B>[K]] extends [En] ? K : never;
}[keyof EntitiesOf<B>] &
  string;
