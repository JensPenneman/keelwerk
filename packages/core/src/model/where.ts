import type { PersonalFlags } from '../fields/personal-flags.ts';
import type { PersonalQuery } from '../storage/personal-query.ts';
import type { Empty } from '../types/empty.ts';
import type { Prettify } from './prettify.ts';

/** What a comparison accepts on a field of value type `V` (section 8.3; the wire `Filter` of section 16.4.4). */
export type FieldOps<V> = {
  readonly isNull?: boolean;
  readonly eq?: V;
  readonly ne?: V | null;
  readonly in?: readonly V[];
  readonly nin?: readonly V[];
  readonly gt?: V;
  readonly gte?: V;
  readonly lt?: V;
  readonly lte?: V;
  readonly startsWith?: [V] extends [string] ? string : never;
  readonly contains?: V extends readonly (infer I)[] | ReadonlySet<infer I> ? I : string;
};

/** The operators a personal field offers for its declared capabilities (section 14.7.9.11). */
export type PersonalOps<V, Q extends PersonalQuery> = {
  readonly isNull?: boolean;
} & ('eq' extends Q
  ? {
      readonly eq?: V;
      readonly ne?: V | null;
      readonly in?: readonly V[];
      readonly nin?: readonly V[];
    }
  : Empty) &
  ('prefix' extends Q ? { readonly startsWith?: string } : Empty) &
  ('contains' extends Q ? { readonly contains?: string } : Empty) &
  ('order' extends Q
    ? {
        readonly lt?: V;
        readonly lte?: V;
        readonly gt?: V;
        readonly gte?: V;
      }
    : Empty);

/**
 * A condition on one field: a value (meaning `eq`), `null`, `undefined` (never match, section 8.3)
 * or operators. A field whose flags say `personal` offers only its declared operators, and a bare
 * value only with `eq`.
 */
export type FieldCondition<V, Fd = unknown> = Fd extends {
  readonly flags: { readonly personal: infer P extends PersonalFlags };
}
  ?
      | ('eq' extends P['queries'][number] ? V : never)
      | null
      | undefined
      | Prettify<PersonalOps<Exclude<V, undefined>, P['queries'][number]>>
  : V | null | undefined | FieldOps<Exclude<V, undefined>>;

/**
 * What a relation accepts (section 8.3): `some`, `none` and `every` over a to-many relation (its
 * `Target` is an array of the related row), `is` over a to-one one, each with a condition on the
 * related rows.
 */
export type RelationOps<Target> = Target extends readonly (infer Row)[]
  ? {
      readonly some?: Where<Row>;
      readonly none?: Where<Row>;
      readonly every?: Where<Row>;
    }
  : { readonly is?: Where<Target> };

/** The relation members of a condition: `Rels` maps each relation name to the related row (to-one) or an array of it (to-many). */
export type RelationWhere<Rels> = {
  readonly [K in keyof Rels]?: RelationOps<Rels[K]>;
};

/**
 * The object form of the condition AST over the fields of a row. `F` is the entity's fields, so
 * personal fields narrow to the operators their capabilities allow; without it every field offers
 * every operator. `Rels` maps relation names to the related row (to-one) or an array of it (to-many) and adds their quantifiers.
 */
export type Where<R, F = unknown, Rels = Empty> = {
  readonly [K in keyof R]?: FieldCondition<R[K], K extends keyof F ? F[K] : unknown>;
} & RelationWhere<Rels> & {
    readonly or?: readonly Where<R, F, Rels>[];
    readonly and?: readonly Where<R, F, Rels>[];
    readonly not?: Where<R, F, Rels>;
  };
