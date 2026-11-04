/** A dependency list of a base or module (`requires`, `optional`), empty when absent. */
export type ListOf<B, K extends string> = B extends { readonly [P in K]: infer L }
  ? L
  : readonly [];
