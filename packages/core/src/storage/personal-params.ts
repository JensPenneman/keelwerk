/** The parameters of section 14.7.9.2 with their defaults applied. */
export interface PersonalParams {
  /** 128 unless truncated. */
  readonly eq: { readonly bits: number };
  readonly prefix: { readonly min: number; readonly max: number };
  readonly contains: { readonly bits: number };
  readonly order: { readonly bytes: number };
}
