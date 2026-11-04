declare const pendingBrand: unique symbol;

/**
 * What a handler's generator yields. Only a request's own iterator produces it, so `yield request`
 * and a bare `yield` do not type-check; `yield* request` does and is typed by the request.
 */
export interface Pending {
  readonly [pendingBrand]: true;
}

/** A pure generator handler or helper answering `T` (section 7.9.2). */
export type Gen<T> = Generator<Pending, T, unknown>;

/** Request kinds the interpreter answers (section 7.9.3). */
export type RequestKind =
  | 'load'
  | 'maybe'
  | 'ask'
  | 'all'
  | 'flag'
  | 'id'
  | 'random'
  | 'secret'
  | 'compute'
  | 'perform';

/** A plain value the kernel answers; `yield*` delegates to its one-step iterator and types the answer. */
export interface Request<T> {
  readonly kind: RequestKind;
  [Symbol.iterator](): Gen<T>;
}
