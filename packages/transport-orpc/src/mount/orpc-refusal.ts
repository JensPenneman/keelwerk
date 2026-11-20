import type { KeelwerkError } from '@keelwerk/core';
import { toWire } from '@keelwerk/core';
import { audienceOf, statusOfError } from '@keelwerk/core/http';
import type { OrpcContext } from '../router/orpc-context.ts';
import { failureHeaders } from './failure-headers.ts';

/**
 * The answer to a request the handler refuses before oRPC runs (an API version it has no mount for,
 * a path it does not know, a handler that is shutting down), in the form oRPC itself answers an
 * error: the RPC handler wraps it as `{ json, meta }`, the OpenAPI handler answers it as it is, and
 * `data` is the wire error of the caller's audience (section 16.4.6). An internal error is logged once.
 */
export function orpcRefusal(
  error: KeelwerkError,
  context: Pick<OrpcContext, 'session' | 'development' | 'requestId' | 'log' | 'answer'>,
  kind: 'rpc' | 'openapi',
  status: number = statusOfError(error),
): Response {
  if (error.kind === 'internal') {
    context.log.error('The oRPC request failed.', {
      requestId: context.requestId,
      code: error.code,
      cause: error.cause,
    });
  }
  context.answer.failure = error;
  const wire = toWire(error, audienceOf(context.session, context.development));
  const body = {
    defined: false,
    code: error.code,
    status,
    message: wire.message,
    data: { ...wire, requestId: context.requestId },
  };
  const headers = new Headers({ 'content-type': 'application/json' });
  failureHeaders(headers, error, status);
  return new Response(JSON.stringify(kind === 'rpc' ? { json: body, meta: [] } : body), {
    status,
    headers,
  });
}
