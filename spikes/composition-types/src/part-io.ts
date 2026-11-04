import type { PageOutput, RowOutput } from './action-part.ts';
import type { AnyModule } from './any-module.ts';
import type { EntityNames } from './base-members.ts';
import type { AnyErrorSpec, ErrorSpecBase } from './define-error.ts';
import type { EffectOutcome } from './effect-outcome.ts';
import type { Id } from './id.ts';
import type { DependencyRow, EntityNameOf, OwnEntityValue, OwnRow } from './module-rows.ts';
import type { OutcomeShape } from './outcome-of.ts';
import type { Page } from './page.ts';
import type { EntityOutputSpec } from './page-of.ts';
import type { BaseOf, ContributionTargetOf, OwnerOf, WhenOf } from './part-source.ts';
import type { PrincipalKind } from './principal.ts';
import type { Shape } from './shape.ts';
import type { ShapeValue } from './shape-value.ts';

/** The output marker when `output` is omitted. */
export interface NoOutput {
  readonly kind: 'noOutput';
}

/** What `input` accepts: a shape, or `outcomeOf(effect)` for continuations. */
export type InputSpec = Shape | OutcomeShape<unknown>;

/** What `output` accepts. */
export type OutputSpec = Shape | EntityOutputSpec<'page' | 'row', object> | NoOutput;

/** The input value a handler receives. */
export type InputValue<In, Owner extends string> =
  In extends Shape<infer F>
    ? ShapeValue<F, Owner, 'input'>
    : In extends OutcomeShape<infer O>
      ? { readonly outcome: EffectOutcome<O> }
      : {};

/** What a handler produces as output (module-local rows). */
export type HandlerOutput<Out, S, Default> =
  Out extends Shape<infer F>
    ? ShapeValue<F, OwnerOf<S>, 'draft'>
    : Out extends EntityOutputSpec<'page', infer En>
      ? Page<OwnRow<BaseOf<S>, EntityNameOf<BaseOf<S>, En>, 'readable'>>
      : Out extends EntityOutputSpec<'row', infer En>
        ? OwnRow<BaseOf<S>, EntityNameOf<BaseOf<S>, En>, 'readable'>
        : Default;

/** What callers receive; entity rows stay markers until the app resolves them. */
export type WireOutput<Out, S, Default> =
  Out extends Shape<infer F>
    ? ShapeValue<F, OwnerOf<S>, 'stored'>
    : Out extends EntityOutputSpec<'page', infer En>
      ? PageOutput<`${OwnerOf<S>}.${EntityNameOf<BaseOf<S>, En>}`>
      : Out extends EntityOutputSpec<'row', infer En>
        ? RowOutput<`${OwnerOf<S>}.${EntityNameOf<BaseOf<S>, En>}`>
        : Default;

/** The declared errors of an action as a union of `{ code, data }`. */
export type ErrorUnion<Er> = Er extends readonly (infer E)[]
  ? E extends ErrorSpecBase<infer C, infer D>
    ? { readonly code: C; readonly data: D }
    : never
  : never;

/** What an entity part is mounted on: an own entity by value, or a contribution target's entity by name. */
export type EntityTargetOf<S> = OwnEntityValue<BaseOf<S>> | EntityNames<ContributionTargetOf<S>>;

/** The entity name of a mount. */
export type TargetName<S, T> = (T extends string ? T : EntityNameOf<BaseOf<S>, T>) & string;

/** The reference of the mounted entity, 'module.entity'. */
export type TargetRef<S, T> =
  `${T extends string ? ContributionTargetOf<S>['id'] : OwnerOf<S>}.${TargetName<S, T>}`;

/** The full current row an entity command receives: the module's row type of the target. */
export type CurrentRow<S, T> = T extends string
  ? ContributionTargetOf<S> extends infer D extends AnyModule
    ? DependencyRow<BaseOf<S>, WhenOf<S>, D, T>
    : never
  : OwnRow<BaseOf<S>, TargetName<S, T>>;

/** The target entity of `ctx.events`: own entities only. */
export type EventTarget<S, T> = T extends string ? never : TargetName<S, T>;

/** The input the kernel adds to entity-mounted instance commands. */
export interface InstanceInput<Ref extends string> {
  readonly id: Id<Ref>;
  readonly ifVersion?: number;
}

/** The input page queries accept on top of their own. */
export interface PageInput {
  readonly first?: number;
  readonly after?: string;
}

/** Options shared by every action (section 7.3). */
export interface ActionOptions<
  In,
  Out,
  Er extends readonly AnyErrorSpec[],
  Pk extends PrincipalKind,
> {
  readonly input?: In;
  readonly output?: Out;
  readonly errors?: Er;
  readonly auth?: 'policy' | { readonly public: true };
  readonly principal?: Pk | readonly Pk[];
  readonly scope?: 'tenant' | 'backend' | 'deployment';
  readonly idempotent?: boolean;
  readonly timeoutMs?: number;
  readonly hints?: { readonly [transport: string]: object };
  readonly description?: string;
  readonly deprecated?: { readonly reason: string; readonly at?: string; readonly sunset?: string };
  readonly gate?: string;
}
