/** The entities of a module base or module value. */
export type EntitiesOf<M> = M extends { readonly entities: infer Es } ? Es : {};

/** The entity names of a module base or module value. */
export type EntityNames<M> = keyof EntitiesOf<M> & string;

/** One entity of a module base or module value, `never` when it does not exist. */
export type EntityAt<M, E> = E extends keyof EntitiesOf<M> ? EntitiesOf<M>[E] : never;

/** The fields of an entity or entity patch. */
export type FieldsOf<En> = [En] extends [{ readonly fields: infer F }] ? F : {};

/** The domain events of an entity. */
export type EventsOf<En> = [En] extends [{ readonly events: infer Ev }] ? Ev : {};

/** The relations of an entity or entity patch. */
export type RelationsOf<En> = [En] extends [{ readonly relations: infer R }] ? R : {};

/** The contribution declarations of a module base. */
export type ContributionsOf<B> = B extends { readonly contributions: infer C } ? C : {};

/** The condition declarations of a module base. */
export type ConditionsOf<B> = B extends { readonly conditions: infer C } ? C : {};

/** A dependency list of a base or module (`requires`, `optional`), empty when absent. */
export type ListOf<B, K extends string> = B extends { readonly [P in K]: infer L }
  ? L
  : readonly [];

/** The ids of the modules (not the contracts) in a dependency list. */
export type ModuleIdsIn<L> = L extends readonly (infer R)[]
  ? R extends { readonly kind: 'module'; readonly id: infer I extends string }
    ? I
    : never
  : never;

/** The names of the contracts of one level in a dependency list. */
export type ContractsIn<L, Level extends string> = L extends readonly (infer R)[]
  ? R extends {
      readonly kind: 'contract';
      readonly contract: infer C extends string;
      readonly level: Level;
    }
    ? C
    : never
  : never;
