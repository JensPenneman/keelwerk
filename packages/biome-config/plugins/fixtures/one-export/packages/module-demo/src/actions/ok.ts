const local = 1;
export type Input = { readonly id: string };
export interface Output {
  readonly id: string;
}
export type Local = typeof local;
export const only = (input: Input): Output => input;
