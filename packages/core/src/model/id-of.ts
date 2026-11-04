/** The id type of a row. */
export type IdOf<R> = R extends { readonly id: infer I } ? I : string;
