import type { StateToken } from '../events/state-token.ts';
import type { AnyModule } from '../model/any-module.ts';
import type { AnyModuleBase } from '../model/any-module-base.ts';
import type { DependencyRow } from '../model/dependency-row.ts';
import type { EntityNames } from '../model/entities-of.ts';
import type { EntityChange } from '../model/entity-change.ts';
import type { LiveSource } from '../model/live-source.ts';
import type { OwnRow } from '../model/own-row.ts';
import type { ModuleById, PresentIds, PresentModules } from '../model/present-modules.ts';
import type { Where } from '../model/where.ts';

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
      readonly ids?: readonly string[];
      readonly fields?: readonly string[];
      readonly includeArchived?: boolean;
      readonly from?: 'now' | 'beginning';
      readonly after?: StateToken | undefined;
    },
  ): LiveSource<EntityChange<LiveRow<B, W, I, E>>>;
}
