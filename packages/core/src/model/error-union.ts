import type { ErrorDefinition } from '../errors/error-definition.ts';

/** The declared errors of an action as a union of `{ code, data }`. */
export type ErrorUnion<Er> = Er extends readonly (infer E)[]
  ? E extends ErrorDefinition<infer C, infer D>
    ? { readonly code: C; readonly data: D }
    : never
  : never;
