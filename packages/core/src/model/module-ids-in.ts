/** The ids of the modules (not the contracts) in a dependency list. */
export type ModuleIdsIn<L> = L extends readonly (infer R)[]
  ? R extends { readonly kind: 'module'; readonly id: infer I extends string }
    ? I
    : never
  : never;
