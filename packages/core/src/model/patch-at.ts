import type { AnyModule } from './any-module.ts';
import type { EntityFields } from './app-entities.ts';
import type { NonHidden } from './non-hidden.ts';
import type { PatchOf } from './patch-of.ts';

/** The patch shape of an entity of a selection. */
export type PatchAt<Ms extends readonly AnyModule[], I extends string, E extends string> = PatchOf<
  NonHidden<EntityFields<Ms, I, E>>
>;
