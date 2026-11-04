import type { AnyModule } from './any-module.ts';
import type { ContributionsOf, EntityAt, EntityNames, EventsOf } from './base-members.ts';
import type { CamelCase } from './camel-case.ts';
import type { Draft } from './decision.ts';
import type { AnyModuleBase } from './define-module-base.ts';
import type { Id } from './id.ts';
import type { ModuleById, PresentIds, PresentModules } from './module-presence.ts';
import type { ContributedFields, DependencyRow, IdOf, OwnFields, OwnRow } from './module-rows.ts';
import type { Prettify } from './prettify.ts';
import type { Shape } from './shape.ts';
import type { ShapeValue } from './shape-value.ts';
import type { InsertOf, PatchOf } from './write-shapes.ts';

type EventPayload<S, Owner extends string> =
  S extends Shape<infer F> ? ShapeValue<F, Owner, 'draft'> : never;

type EventWrites<R, Ev, Owner extends string> = {
  readonly [K in keyof Ev]: (target: IdOf<R> | R, payload: EventPayload<Ev[K], Owner>) => Draft;
};

type OwnWrites<B extends AnyModuleBase, E extends string> = EntityWrites<
  OwnRow<B, E>,
  Prettify<InsertOf<OwnFields<B, E>, B['id']> & { readonly id?: Id<`${B['id']}.${E}`> }>,
  PatchOf<OwnFields<B, E>, B['id']>
> &
  EventWrites<OwnRow<B, E>, EventsOf<EntityAt<B, E>>, B['id']>;

type ContributionTargetIds<B> = {
  [K in keyof ContributionsOf<B>]: ContributionsOf<B>[K] extends {
    readonly to: { readonly id: infer I };
  }
    ? I
    : never;
}[keyof ContributionsOf<B>];

type ContributedEntityNames<B, I> = {
  [K in keyof ContributionsOf<B>]: ContributionsOf<B>[K] extends {
    readonly to: { readonly id: I };
    readonly entities: infer Es;
  }
    ? keyof Es & string
    : never;
}[keyof ContributionsOf<B>];

type ContributedWrites<B extends AnyModuleBase, W, D, E extends string> = D extends AnyModule
  ? {
      update(
        target: Id<`${D['id']}.${E}`> | DependencyRow<B, W, D, E>,
        patch: PatchOf<ContributedFields<B, W, D['id'], E>, B['id']>,
      ): Draft;
    }
  : never;

/** Draft constructors of one entity, typed by `Insert` and `Patch` (section 14.8.1). */
export interface EntityWrites<R, I, P> {
  create(values: I): Draft;
  update(target: IdOf<R> | R, patch: P): Draft;
  archive(target: IdOf<R> | R, options?: { readonly reason?: string }): Draft;
  restore(target: IdOf<R> | R): Draft;
}

/**
 * `ctx.write`: drafts of own entities (and their domain events by name), and for present
 * dependencies `update` drafts limited to the fields this module contributed (section 7.6).
 */
export type WritesOf<B extends AnyModuleBase, W> = {
  readonly [I in B['id'] as CamelCase<I>]: { readonly [E in EntityNames<B>]: OwnWrites<B, E> };
} & {
  readonly [I in Extract<PresentIds<B, W>, ContributionTargetIds<B>> as CamelCase<I>]: {
    readonly [E in ContributedEntityNames<B, I>]: ContributedWrites<
      B,
      W,
      ModuleById<PresentModules<B, W>, I>,
      E
    >;
  };
};
