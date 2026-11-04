declare const pendingBrand: unique symbol;

/**
 * What a handler's generator yields. Only a request's own iterator produces it, so `yield request`
 * and a bare `yield` do not type-check; `yield* request` does and is typed by the request.
 */
export interface Pending {
  readonly [pendingBrand]: true;
}
