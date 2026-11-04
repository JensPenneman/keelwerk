type Comparison<V> = {
  readonly isNull?: boolean;
  readonly eq?: V;
  readonly ne?: V;
  readonly in?: readonly V[];
  readonly notIn?: readonly V[];
  readonly gt?: V;
  readonly gte?: V;
  readonly lt?: V;
  readonly lte?: V;
  readonly contains?: [V] extends [string] ? string : never;
  readonly startsWith?: [V] extends [string] ? string : never;
};

/** A condition on one field: a value (null and undefined never match, section 8.3) or a comparison. */
export type FieldCondition<V> = V | null | undefined | Comparison<Exclude<V, undefined>>;

/** The object form of the condition AST over the fields of a row (sections 8.3 and 14.3.4). */
export type Where<R> = { readonly [K in keyof R]?: FieldCondition<R[K]> } & {
  readonly or?: readonly Where<R>[];
  readonly and?: readonly Where<R>[];
  readonly not?: Where<R>;
};
