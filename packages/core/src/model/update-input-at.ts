import type { AnyModule } from './any-module.ts';
import type { InstanceInput } from './instance-input.ts';
import type { PatchAt } from './patch-at.ts';

/** The input of an entity's generated `update` (and of one `update` entry of `set`): the instance and its `patch`. */
export type UpdateInputAt<
  Ms extends readonly AnyModule[],
  I extends string,
  E extends string,
> = InstanceInput<`${I}.${E}`> & { readonly patch: PatchAt<Ms, I, E> };
