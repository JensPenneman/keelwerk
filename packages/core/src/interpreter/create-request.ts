import type { Gen } from '../protocol/gen.ts';
import type { Pending } from '../protocol/pending.ts';
import type { Request } from '../protocol/request.ts';
import type { RequestAuthorities } from './request-authorities.ts';

/**
 * Builds a request: a frozen plain object with a `kind`, the members of its type and the one-step
 * iterator that makes `yield*` hand it to the interpreter and return the answer. `authority`
 * names the module whose context built the request, so a service called from another module's
 * part loads with its provider's authority; it is recorded in the invocation's `authorities`,
 * not on the request.
 */
export function createRequest<Q extends Request<unknown>>(
  authorities: RequestAuthorities,
  fields: Omit<Q, typeof Symbol.iterator>,
  authority?: string,
): Q {
  const request = {
    ...fields,
    *[Symbol.iterator](): Gen<unknown> {
      const answer: unknown = yield request as unknown as Pending;
      return answer;
    },
  };
  Object.freeze(request);
  if (authority !== undefined) authorities.set(request, authority);
  return request as unknown as Q;
}
