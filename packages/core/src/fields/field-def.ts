import type { FieldKind } from '../storage/field-kind.ts';
import type { PersonalQuery } from '../storage/personal-query.ts';
import type { FieldFlags, MergeType, NoFlags, WithFlag } from './field-flags.ts';
import type { FieldOptions } from './field-options.ts';
import type { PersonalFlags } from './personal-flags.ts';
import type { PersonalOptions } from './personal-options.ts';

declare const valueType: unique symbol;

/** `eq` added to a capability list that lacks it. */
type WithEq<Q extends readonly PersonalQuery[]> = 'eq' extends Q[number]
  ? Q
  : readonly ['eq', ...Q];

/** The personal flag after a lookup modifier: `.unique()` and `.index()` imply `eq` (section 14.7.9.2). */
type ImplyEq<P extends FieldFlags['personal']> =
  P extends PersonalFlags<infer Q, infer S> ? PersonalFlags<WithEq<Q>, S> : P;

/** The effective capabilities of `.personal()` on a field with flags `F`. */
type QueriesFor<F extends FieldFlags, Q extends readonly PersonalQuery[]> = F extends
  | { readonly unique: true }
  | { readonly indexed: true }
  ? WithEq<Q>
  : Q;

type QueriesOf<O> = O extends { readonly queries: infer Q extends readonly PersonalQuery[] }
  ? Q
  : readonly [];

type SubjectOf<O> = O extends { readonly subject: infer S extends string } ? S : null;

/** A reference to an entity of another module. */
export interface AbsoluteRef<M extends string = string, E extends string = string> {
  readonly module: M;
  readonly entity: E;
}

/** A reference to an entity of the declaring or contributing module, resolved per source. */
export interface OwnRef<E extends string = string> {
  readonly own: true;
  readonly entity: E;
}

/** What a field references, if anything. */
export type FieldRef = AbsoluteRef | OwnRef | null;

/**
 * A field: value type, flags, reference and kind in the type, and at the value level everything
 * a projection needs (constraints, default, description, tag). Every modifier returns a field
 * that keeps every earlier flag and the reference.
 */
export interface FieldDef<
  T,
  F extends FieldFlags = NoFlags,
  R extends FieldRef = null,
  K extends FieldKind = FieldKind,
> {
  readonly kind: K;
  readonly flags: F;
  readonly ref: R;
  readonly options: FieldOptions;
  readonly inner: AnyField | null;
  readonly defaultValue: T | undefined;
  readonly description: string | null;
  readonly deprecation: string | null;
  readonly personalOptions: PersonalOptions | null;
  readonly [valueType]?: T;
  optional(): FieldDef<T, WithFlag<F, 'optional', true>, R, K>;
  default(value: T): FieldDef<T, WithFlag<F, 'defaulted', true>, R, K>;
  unique(): FieldDef<
    T,
    WithFlag<
      WithFlag<WithFlag<F, 'unique', true>, 'merge', 'exclusive'>,
      'personal',
      ImplyEq<F['personal']>
    >,
    R,
    K
  >;
  index(): FieldDef<
    T,
    WithFlag<WithFlag<F, 'indexed', true>, 'personal', ImplyEq<F['personal']>>,
    R,
    K
  >;
  hidden(): FieldDef<T, WithFlag<F, 'hidden', true>, R, K>;
  maskable(): FieldDef<T, WithFlag<F, 'maskable', true>, R, K>;
  personal(): FieldDef<
    T,
    WithFlag<F, 'personal', PersonalFlags<QueriesFor<F, readonly []>, null>>,
    R,
    K
  >;
  personal<const O extends PersonalOptions>(
    options: O,
  ): FieldDef<
    T,
    WithFlag<F, 'personal', PersonalFlags<QueriesFor<F, QueriesOf<O>>, SubjectOf<O>>>,
    R,
    K
  >;
  stateOnly(): FieldDef<T, WithFlag<F, 'stateOnly', true>, R, K>;
  merge<const M extends MergeType>(type: M): FieldDef<T, WithFlag<F, 'merge', M>, R, K>;
  tag<const N extends number>(tag: N): FieldDef<T, WithFlag<F, 'tag', N>, R, K>;
  describe(text: string): FieldDef<T, F, R, K>;
  deprecated(reason: string): FieldDef<T, F, R, K>;
}

/** Any field. */
export type AnyField = FieldDef<unknown, FieldFlags, FieldRef, FieldKind>;

/** The declared value type of a field (own references are `never` until resolved). */
export type ValueOfField<F> =
  F extends FieldDef<infer T, FieldFlags, FieldRef, FieldKind> ? T : never;
