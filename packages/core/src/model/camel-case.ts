/** A hyphenated module id in lower camel case, as the context names it (gap G15). */
export type CamelCase<S extends string> = S extends `${infer Head}-${infer Tail}`
  ? `${Head}${Capitalize<CamelCase<Tail>>}`
  : S;
