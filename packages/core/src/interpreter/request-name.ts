import type { AnyRequest } from '../protocol/any-request.ts';

/** A request named for an error: its kind and, where it has one, its operation. */
export function requestName(request: AnyRequest): string {
  return 'op' in request ? `${request.kind}.${request.op}` : request.kind;
}
