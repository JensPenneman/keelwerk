import type { KeelwerkError } from '@keelwerk/core';
import { wwwAuthenticateValue } from '@keelwerk/core/http';
import { type AnyTRPCRouter, getTRPCErrorShape, transformTRPCResponse } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import { trpcErrorOf } from '../errors/trpc-error-of.ts';
import type { TrpcContext } from '../router/trpc-context.ts';

/**
 * The answer to a request refused before tRPC runs: tRPC's own single-call error form
 * (`{ error: { message, code, data } }`, transformed as the router's transformer does), with the
 * HTTP status of the error's tRPC code unless `status` names another (the body's
 * `data.httpStatus` follows it). The shape comes from the router's own formatter, so
 * `data.keelwerk` is the wire error here too.
 */
export function trpcRefusal(
  router: AnyTRPCRouter,
  error: KeelwerkError,
  context: TrpcContext | undefined,
  status: number = getHTTPStatusCodeFromError(trpcErrorOf(error)),
): Response {
  const config = router._def._config;
  const refused = trpcErrorOf(error);
  const shape = getTRPCErrorShape({
    config,
    error: refused,
    type: 'unknown',
    path: undefined,
    input: undefined,
    ctx: context,
  });
  shape.data.httpStatus = status;
  const headers = new Headers({ 'content-type': 'application/json' });
  if (status === 401) headers.set('www-authenticate', wwwAuthenticateValue);
  if (error.retryAfter !== undefined) headers.set('retry-after', String(error.retryAfter));
  return new Response(JSON.stringify(transformTRPCResponse(config, { error: shape })), {
    status,
    headers,
  });
}
