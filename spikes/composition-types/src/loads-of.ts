import type { AnyModule } from './any-module.ts';
import type { EntityNames } from './base-members.ts';
import type { CamelCase } from './camel-case.ts';
import type { AnyModuleBase } from './define-module-base.ts';
import type {
  ModuleById,
  OptionalIds,
  OptionalModules,
  PresentIds,
  PresentModules,
} from './module-presence.ts';
import type { DependencyRow, IdOf, OwnRow } from './module-rows.ts';
import type { Page } from './page.ts';
import type { Gen, Request } from './request.ts';
import type { Where } from './where.ts';

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

/** Sorting by one field. */
export interface Sort<R> {
  readonly field: keyof R & string;
  readonly direction: 'asc' | 'desc';
}

/** What a query description holds (section 7.9.2). */
export interface QuerySpec<R> {
  readonly where?: Where<R>;
  readonly sort?: readonly Sort<R>[];
  readonly page?: { readonly first?: number; readonly after?: string };
  readonly scan?: { readonly limit: number; readonly partial?: boolean };
  readonly search?: { readonly index: string; readonly text: string };
}

/** A query description: a request whose answer is a page of rows, planned and run by the kernel. */
export interface QueryDescription<R> extends Request<Page<R>> {
  readonly entity: string;
  readonly spec: QuerySpec<R>;
}

/** One entry of a row's history. */
export interface HistoryEntry<R> {
  readonly version: number;
  readonly type: string;
  readonly at: Temporal.Instant;
  readonly changes: { readonly [K in keyof R]?: { readonly before: R[K]; readonly after: R[K] } };
}

/** The load requests of one entity (section 7.9.3); `forCaller()` narrows them to the caller's view. */
export interface EntityLoads<R, Rc> {
  byId(id: IdOf<R>): Request<R | undefined>;
  one(query: { readonly where: Where<R> }): Request<R | undefined>;
  many(query: {
    readonly where?: Where<R>;
    readonly sort?: readonly Sort<R>[];
    readonly limit?: number;
  }): Request<readonly R[]>;
  count(where?: Where<R>): Request<number>;
  exists(where: Where<R>): Request<boolean>;
  query(query: QuerySpec<R>): QueryDescription<R>;
  history(
    id: IdOf<R>,
    options?: { readonly asOf?: Temporal.Instant },
  ): Request<readonly HistoryEntry<R>[]>;
  forCaller(): EntityLoads<Rc, Rc>;
}

/** The Maybe accessor of an optional module (decision 32b): a request answered with `undefined` when the module is absent. */
export interface Maybe<L> {
  ifPresent<T>(f: (present: L) => Request<T> | Gen<T>): Request<T | undefined>;
}

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
