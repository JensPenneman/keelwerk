import type { Request } from './request.ts';

/** `ctx.newId(entity)`: a UUIDv7 for a row of `entity`. */
export interface IdRequest<T = string> extends Request<T> {
  readonly kind: 'id';
  readonly entity: string;
}
