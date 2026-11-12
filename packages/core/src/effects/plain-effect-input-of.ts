/** The plain members of an effect part's stored input (`'~types'.plain`, S-166, S-177): what a pending effect carries; `never` for anything else. */
export type PlainEffectInputOf<E> = E extends {
  readonly '~types'?: { readonly plain: infer P };
}
  ? P
  : never;
