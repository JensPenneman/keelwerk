import type { StreamDeclaration } from '../dsl/define-stream.ts';
import type { Shape } from '../fields/shape.ts';
import type { FieldValue, ShapeValue } from '../fields/shape-value.ts';
import type { Id } from '../ids/id.ts';
import type { AnyModule } from '../model/any-module.ts';
import type { AnyModuleBase } from '../model/any-module-base.ts';
import type { CamelCase } from '../model/camel-case.ts';
import type { ContributedFields } from '../model/contributed-member.ts';
import type { ContributionsOf } from '../model/contributions-of.ts';
import type { DependencyRow } from '../model/dependency-row.ts';
import type { EntityAt, EntityNames } from '../model/entities-of.ts';
import type { EventsOf } from '../model/events-of.ts';
import type { IdOf } from '../model/id-of.ts';
import type { InsertOf } from '../model/insert-of.ts';
import type { OwnFields, OwnRow } from '../model/own-row.ts';
import type { PatchOf } from '../model/patch-of.ts';
import type { ModuleById, PresentIds, PresentModules } from '../model/present-modules.ts';
import type { Prettify } from '../model/prettify.ts';
import type { StreamsOf } from '../model/streams-of.ts';
import type { EventDraft } from '../protocol/event-draft.ts';
import type { UpdateDraft } from '../protocol/update-draft.ts';
import type { EntityWrites } from './entity-writes.ts';
import type { StreamWrites } from './stream-writes.ts';

type EventPayload<S, Owner extends string> =
  S extends Shape<infer F> ? ShapeValue<F, Owner, 'draft'> : never;

type EventWrites<R, Ev, Owner extends string> = {
  readonly [K in keyof Ev]: (
    target: IdOf<R> | R,
    payload: EventPayload<Ev[K], Owner>,
  ) => EventDraft;
};

type OwnWrites<B extends AnyModuleBase, E extends string> = EntityWrites<
  OwnRow<B, E>,
  Prettify<InsertOf<OwnFields<B, E>, B['id']> & { readonly id?: Id<`${B['id']}.${E}`> }>,
  PatchOf<OwnFields<B, E>, B['id']>
> &
  EventWrites<OwnRow<B, E>, EventsOf<EntityAt<B, E>>, B['id']>;

type OwnStreamWrites<B extends AnyModuleBase> = {
  readonly [S in keyof StreamsOf<B> & string]: StreamsOf<B>[S] extends StreamDeclaration<
    infer K,
    infer Rf
  >
    ? StreamWrites<FieldValue<K, B['id'], 'draft'>, ShapeValue<Rf, B['id'], 'draft'>>
    : never;
};

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
      ): UpdateDraft;
    }
  : never;

/**
 * `ctx.write`: drafts of own entities (and their domain events by name), and for present
 * dependencies `update` drafts limited to the fields this module contributed that are active in
 * the part (section 7.6, decision 106).
 */
export type WritesOf<B extends AnyModuleBase, W> = {
  readonly [I in B['id'] as CamelCase<I>]: {
    readonly [E in EntityNames<B>]: OwnWrites<B, E>;
  } & OwnStreamWrites<B>;
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
