import type { Gen } from './gen.ts';
import type { RequestKind } from './request-kind.ts';

/** A plain value the kernel answers; `yield*` delegates to its one-step iterator and types the answer. */
export interface Request<T> {
  readonly kind: RequestKind;
  [Symbol.iterator](): Gen<T>;
}
