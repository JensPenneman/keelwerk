import type { AnyModule } from './any-module.ts';
import type { EntityNames } from './base-members.ts';
import type { ConfigOf } from './config-of.ts';
import type { Ability, FlagRequests, Logger, RequestInfo, Scope } from './decide-context.ts';
import type { AnyModuleBase } from './define-module-base.ts';
import type { EntityChange } from './entity-change.ts';
import type { LiveSource, StateToken } from './live-source.ts';
import type {
  ModuleById,
  OptionalContracts,
  PresentContracts,
  PresentIds,
  PresentModules,
} from './module-presence.ts';
import type { DependencyRow, OwnRow } from './module-rows.ts';
import type { PrincipalKind, PrincipalOf } from './principal.ts';
import type { Where } from './where.ts';

type LiveRow<B extends AnyModuleBase, W, I, E extends string> = I extends B['id']
  ? OwnRow<B, E, 'readable'>
  : ModuleById<PresentModules<B, W>, I> extends infer D extends AnyModule
    ? DependencyRow<B, W, D, E, 'readable'>
    : never;
type LiveEntityNames<B extends AnyModuleBase, W, I> = I extends B['id']
  ? EntityNames<B>
  : EntityNames<ModuleById<PresentModules<B, W>, I>>;

/** Source descriptions over the module's own and present dependencies' entities. */
export interface LiveQueries<B extends AnyModuleBase, W> {
  entity<const I extends B['id'] | PresentIds<B, W>, const E extends LiveEntityNames<B, W, I>>(
    module: I,
    entity: E,
    query?: {
      readonly where?: Where<LiveRow<B, W, I, E>>;
      readonly after?: StateToken | undefined;
    },
  ): LiveSource<EntityChange<LiveRow<B, W, I, E>>>;
}

/** `ctx.live`: present with the live contract, possibly undefined when it is optional, absent otherwise. */
export type LiveOf<B extends AnyModuleBase, W> =
  'live' extends PresentContracts<B, W>
    ? LiveQueries<B, W>
    : 'live' extends OptionalContracts<B, W>
      ? LiveQueries<B, W> | undefined
      : never;

/** The context of a subscription's `source` (section 7.6). */
export interface SourceContext<
  B extends AnyModuleBase,
  W = readonly [],
  Pk extends PrincipalKind = PrincipalKind,
  T = never,
> {
  readonly scope: Scope;
  readonly principal: PrincipalOf<Pk>;
  readonly ability: Ability;
  readonly config: ConfigOf<B>;
  readonly request: RequestInfo;
  readonly flags: FlagRequests;
  readonly live: LiveOf<B, W>;
  readonly target: T;
  readonly log: Logger;
}
