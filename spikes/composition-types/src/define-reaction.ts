import type { AnyModule } from './any-module.ts';
import type { EntityAt, EntityNames, EventsOf } from './base-members.ts';
import type { DecideContext } from './decide-context.ts';
import type { Decision } from './decision.ts';
import type { ModuleById, PresentModules } from './module-presence.ts';
import type { DependencyRow, OwnRow } from './module-rows.ts';
import type { BaseOf, OwnerOf, PartSource, WhenOf } from './part-source.ts';
import type { Gen } from './request.ts';
import type { Shape } from './shape.ts';
import type { ShapeValue } from './shape-value.ts';

type GeneratedEventName = 'created' | 'changed' | 'archived' | 'restored' | 'erased';
type EventRefsOfModule<I extends string, M> = {
  [E in EntityNames<M>]: `${I}.${E}.${(keyof EventsOf<EntityAt<M, E>> & string) | GeneratedEventName}`;
}[EntityNames<M>];

type ModuleAt<S, I> =
  I extends OwnerOf<S> ? BaseOf<S> : ModuleById<PresentModules<BaseOf<S>, WhenOf<S>>, I>;
type ReactionRow<S, I, E extends string> =
  I extends OwnerOf<S>
    ? OwnRow<BaseOf<S>, E>
    : ModuleAt<S, I> extends infer D extends AnyModule
      ? DependencyRow<BaseOf<S>, WhenOf<S>, D, E>
      : never;
type ReactionData<S, I extends string, E, N> = N extends keyof EventsOf<EntityAt<ModuleAt<S, I>, E>>
  ? EventsOf<EntityAt<ModuleAt<S, I>, E>>[N] extends Shape<infer F>
    ? ShapeValue<F, I, 'stored'>
    : never
  : { readonly [field: string]: unknown };

/** Every event reference a part may react to: own entities and present dependencies' entities. */
export type EventRefsOf<S> =
  | EventRefsOfModule<OwnerOf<S>, BaseOf<S>>
  | (PresentModules<BaseOf<S>, WhenOf<S>> extends infer D
      ? D extends AnyModule
        ? EventRefsOfModule<D['id'], D>
        : never
      : never);

/** What every reaction event carries (section 7.7). */
export interface ReactionEventBase<Name extends string, Data, R> {
  readonly id: string;
  readonly type: Name;
  readonly stream: { readonly type: string; readonly id: string };
  readonly version: number;
  readonly data: Data;
  readonly before: Partial<R> | null;
  readonly commandId: string | null;
  readonly at: Temporal.Instant;
}

/** An event delivered inline, in the producing unit: the row right after the event. */
export interface InlineReactionEvent<Name extends string, Data, R>
  extends ReactionEventBase<Name, Data, R> {
  readonly state: R;
}

/** An event delivered as a job: the row when the job runs. */
export interface AsyncReactionEvent<Name extends string, Data, R>
  extends ReactionEventBase<Name, Data, R> {
  readonly current: R | undefined;
}

/** The event a reaction receives, typed by its reference and timing. */
export type ReactionEventOf<
  S,
  On extends string,
  Tm,
> = On extends `${infer I}.${infer E}.${infer N}`
  ? Tm extends 'inline'
    ? InlineReactionEvent<On, ReactionData<S, I, E, N>, ReactionRow<S, I, E>>
    : AsyncReactionEvent<On, ReactionData<S, I, E, N>, ReactionRow<S, I, E>>
  : never;

/** A reaction literal. */
export interface ReactionSpec<S, On extends string, Tm extends 'inline' | 'async'> {
  readonly on: On;
  readonly timing?: Tm;
  readonly key?: (event: ReactionEventOf<S, On, Tm>) => string;
  readonly react: (
    event: ReactionEventOf<S, On, Tm>,
    ctx: DecideContext<BaseOf<S>, WhenOf<S>>,
  ) => Decision | Gen<Decision>;
}

/** A reaction part. */
export interface ReactionPart<S> {
  readonly kind: 'reaction';
  readonly source: S;
  readonly on: string;
  readonly spec: object;
}

/** Defines a reaction; `timing` defaults to 'async' (section 7.7). */
export function defineReaction<
  const S extends PartSource,
  const On extends EventRefsOf<S>,
  const Tm extends 'inline' | 'async' = 'async',
>(source: S, spec: ReactionSpec<S, On, Tm>): ReactionPart<S> {
  return { kind: 'reaction', source, on: spec.on, spec };
}
