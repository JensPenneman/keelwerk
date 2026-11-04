import type { AnyModule } from './any-module.ts';
import type {
  ConditionsOf,
  ContractsIn,
  ContributionsOf,
  EntitiesOf,
  EntityAt,
  FieldsOf,
  ModuleIdsIn,
} from './base-members.ts';
import type { AnyModuleBase } from './define-module-base.ts';
import type { PresentContracts, PresentIds } from './module-presence.ts';
import type { Prettify } from './prettify.ts';
import type { FieldValue } from './shape-value.ts';
import type { SystemFields } from './system-fields.ts';
import type { UnionToIntersection } from './union-to-intersection.ts';

type IsHidden<Fd> = Fd extends { readonly flags: { readonly hidden: true } } ? true : false;
type IsVisible<Fd, View extends RowView> = View extends 'own'
  ? true
  : IsHidden<Fd> extends true
    ? false
    : true;
type IsOptionalAt<Fd, View extends RowView> = Fd extends {
  readonly flags: { readonly optional: true };
}
  ? true
  : View extends 'readable'
    ? Fd extends { readonly flags: { readonly maskable: true } }
      ? true
      : false
    : false;

/**
 * Which view of a row: `own` (the declaring module: hidden fields included), `dependency` (another
 * module's row: hidden fields excluded) and `readable` (as a caller may read it: hidden fields
 * excluded, maskable fields optional; `Readable<R>` of section 8.1).
 */
export type RowView = 'own' | 'dependency' | 'readable';

/** The row type of a set of fields in one view. */
export type RowOf<F, Owner extends string, View extends RowView> = {
  readonly [K in keyof F as IsVisible<F[K], View> extends true
    ? IsOptionalAt<F[K], View> extends true
      ? never
      : K
    : never]: FieldValue<F[K], Owner, 'stored'>;
} & {
  readonly [K in keyof F as IsVisible<F[K], View> extends true
    ? IsOptionalAt<F[K], View> extends true
      ? K
      : never
    : never]?: FieldValue<F[K], Owner, 'stored'> | undefined;
};

/** Fields that may be absent (conditional and contributed fields seen from outside their part). */
export type PartialRowOf<F, Owner extends string, View extends RowView> = {
  readonly [K in keyof F as IsVisible<F[K], View> extends true ? K : never]?:
    | FieldValue<F[K], Owner, 'stored'>
    | undefined;
};

/** The fields a module's conditional parts add to one of its own entities. */
export type ConditionalFields<B, E extends string> = UnionToIntersection<
  {
    [K in keyof ConditionsOf<B>]: ConditionsOf<B>[K] extends {
      readonly entities: { readonly [P in E]: { readonly fields: infer F } };
    }
      ? F
      : never;
  }[keyof ConditionsOf<B>]
>;

/** A declaration's `when` list is satisfied in a part that sees the modules and contracts of `W` as present. */
export type ActiveIn<B, W, When> = [
  | Exclude<ModuleIdsIn<When>, PresentIds<B, W>>
  | Exclude<ContractsIn<When, 'app'>, PresentContracts<B, W>>,
] extends [never]
  ? true
  : false;

/** What a module contributes to entity `E` of module `ToId` under `Member` ('fields' or 'relations'), from contributions active in the part. */
export type ContributedMember<
  B,
  W,
  ToId extends string,
  E extends string,
  Member extends 'fields' | 'relations',
> = UnionToIntersection<
  {
    [K in keyof ContributionsOf<B>]: ContributionsOf<B>[K] extends {
      readonly to: { readonly id: ToId };
      readonly when: infer When;
      readonly entities: { readonly [P in E]: { readonly [M in Member]: infer F } };
    }
      ? ActiveIn<B, W, When> extends true
        ? F
        : never
      : never;
  }[keyof ContributionsOf<B>]
>;

/** The fields a module contributes to entity `E` of module `ToId`, from contributions active in the part. */
export type ContributedFields<B, W, ToId extends string, E extends string> = ContributedMember<
  B,
  W,
  ToId,
  E,
  'fields'
>;

/** A row of an own entity as the module sees it: its fields, and its conditional fields as optional. */
export type OwnRow<
  B extends AnyModuleBase,
  E extends string,
  View extends RowView = 'own',
> = Prettify<
  SystemFields<`${B['id']}.${E}`> &
    RowOf<FieldsOf<EntityAt<B, E>>, B['id'], View> &
    PartialRowOf<ConditionalFields<B, E>, B['id'], View>
>;

/** A row of a dependency's entity: its own fields without hidden ones, plus what this module contributes. */
export type DependencyRow<
  B extends AnyModuleBase,
  W,
  D extends AnyModule,
  E extends string,
  View extends RowView = 'dependency',
> = Prettify<
  SystemFields<`${D['id']}.${E}`> &
    RowOf<FieldsOf<EntityAt<D, E>>, D['id'], View> &
    PartialRowOf<ContributedFields<B, W, D['id'], E>, B['id'], View>
>;

/** Every field record of an own entity: declared and conditional. */
export type OwnFields<B, E extends string> = FieldsOf<EntityAt<B, E>> & ConditionalFields<B, E>;

/** The own entity values of a base. */
export type OwnEntityValue<B> = EntitiesOf<B>[keyof EntitiesOf<B>];

/** The name under which a base lists an entity value. */
export type EntityNameOf<B, En> = {
  [K in keyof EntitiesOf<B>]: [EntitiesOf<B>[K]] extends [En] ? K : never;
}[keyof EntitiesOf<B>] &
  string;

/** The id type of a row. */
export type IdOf<R> = R extends { readonly id: infer I } ? I : string;
