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
