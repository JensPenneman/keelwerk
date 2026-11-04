import type { AnyRequest } from '../protocol/any-request.ts';
import type { RequestAuthorities } from './request-authorities.ts';

/** The module whose context built the request, when the invocation recorded one; otherwise the module of the part that runs. */
export function authorityOf(
  authorities: RequestAuthorities,
  request: AnyRequest,
  fallback: string,
): string {
  return authorities.get(request) ?? fallback;
}
