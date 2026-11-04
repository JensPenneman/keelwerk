import type { AnyRequest } from './any-request.ts';
import type { Request } from './request.ts';

/** `ctx.all([...requests])`: answered together, batched where the adapter can. */
export interface AllRequest<T = readonly unknown[]> extends Request<T> {
  readonly kind: 'all';
  readonly requests: readonly AnyRequest[];
}
