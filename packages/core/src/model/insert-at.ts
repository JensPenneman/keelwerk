import type { AnyModule } from './any-module.ts';
import type { EntityFields } from './app-entities.ts';
import type { InsertOf } from './insert-of.ts';
import type { NonHidden } from './non-hidden.ts';

/** The insert shape of an entity of a selection. */
export type InsertAt<
  Ms extends readonly AnyModule[],
  I extends string,
  E extends string,
> = InsertOf<NonHidden<EntityFields<Ms, I, E>>>;
