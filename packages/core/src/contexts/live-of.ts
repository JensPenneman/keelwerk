import type { AnyModuleBase } from '../model/any-module-base.ts';
import type { OptionalContracts, PresentContracts } from '../model/present-modules.ts';
import type { LiveQueries } from './live-queries.ts';

/** `ctx.live`: present with the live contract, possibly undefined when it is optional, absent otherwise. */
export type LiveOf<B extends AnyModuleBase, W> =
  'live' extends PresentContracts<B, W>
    ? LiveQueries<B, W>
    : 'live' extends OptionalContracts<B, W>
      ? LiveQueries<B, W> | undefined
      : never;
