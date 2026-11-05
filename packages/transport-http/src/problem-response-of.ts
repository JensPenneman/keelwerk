import { type KeelwerkError, toWire } from '@keelwerk/core';
import { problemTitles } from '@keelwerk/core/http';
import { audienceOf } from './audience-of.ts';
import type { HostContext } from './host-context.ts';
import type { RequestState } from './request-state.ts';

/**
 * The error of a request that belongs to a REST mount, answered before the transport sees it (the
 * origin check, for one) as the RFC 9457 document the transport itself would send (section 16.5.3).
 * `base` is the origin and mount path the `type` URI resolves under.
 */
export function problemResponseOf(
  host: HostContext,
  state: RequestState,
  error: KeelwerkError,
  status: number,
  headers: Headers,
  base: string,
): Response {
  const { message, ...wire } = toWire(error, audienceOf(host, state));
  headers.set('content-type', 'application/problem+json');
  const body = {
    type: `${base}/problems/${error.code}`,
    title: problemTitles[error.kind],
    status,
    detail: message,
    instance: `urn:uuid:${state.requestId}`,
    ...wire,
    requestId: state.requestId,
  };
  return new Response(JSON.stringify(body), { status, headers });
}
