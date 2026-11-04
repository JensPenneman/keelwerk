import type { Gen } from '../protocol/gen.ts';
import type { MaybeRequest } from '../protocol/maybe-request.ts';
import type { Request } from '../protocol/request.ts';

/**
 * The Maybe accessor of an optional module (decision 32b): a request answered with `undefined`
 * when the module is absent. It has a short name so an error prints `Maybe<...>` (decision 108).
 */
export interface Maybe<L> {
  ifPresent<T>(f: (present: L) => Request<T> | Gen<T>): MaybeRequest<T>;
}
