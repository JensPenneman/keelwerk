import type { Request } from '../protocol/request.ts';

/** The answers of `ctx.all`, a tuple for a tuple of requests. */
export type AnswersOf<T extends readonly Request<unknown>[]> = {
  -readonly [K in keyof T]: T[K] extends Request<infer A> ? A : never;
};
