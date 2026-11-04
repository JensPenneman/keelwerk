import type { AnyModule } from '../model/any-module.ts';
import type { AnyModuleBase } from '../model/any-module-base.ts';
import type { CamelCase } from '../model/camel-case.ts';
import type { DependencyRow } from '../model/dependency-row.ts';
import type { EntityNames } from '../model/entities-of.ts';
import type { OwnRow } from '../model/own-row.ts';
import type {
  ModuleById,
  OptionalIds,
  OptionalModules,
  PresentIds,
  PresentModules,
} from '../model/present-modules.ts';
import type { EntityLoads } from './entity-loads.ts';
import type { Maybe } from './maybe-accessor.ts';

type OwnLoads<B extends AnyModuleBase> = {
  readonly [E in EntityNames<B>]: EntityLoads<OwnRow<B, E>, OwnRow<B, E, 'readable'>>;
};
type DependencyLoads<B extends AnyModuleBase, W, D> = D extends AnyModule
  ? {
      readonly [E in EntityNames<D>]: EntityLoads<
        DependencyRow<B, W, D, E>,
        DependencyRow<B, W, D, E, 'readable'>
      >;
    }
  : never;

/**
 * `ctx.load`: own entities with hidden fields and secret references, present dependencies without
 * their hidden fields, optional dependencies through the Maybe accessor.
 */
export type LoadsOf<B extends AnyModuleBase, W> = {
  readonly [I in B['id'] as CamelCase<I>]: OwnLoads<B>;
} & {
  readonly [I in PresentIds<B, W> as CamelCase<I>]: DependencyLoads<
    B,
    W,
    ModuleById<PresentModules<B, W>, I>
  >;
} & {
  readonly [I in OptionalIds<B, W> as CamelCase<I>]: Maybe<
    DependencyLoads<B, W, ModuleById<OptionalModules<B, W>, I>>
  >;
};
