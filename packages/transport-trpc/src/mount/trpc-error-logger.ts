import type { Logger } from '@keelwerk/core';
import type { TRPCError } from '@trpc/server';
import { keelwerkErrorOfTrpc } from '../errors/keelwerk-error-of-trpc.ts';

/**
 * tRPC's `onError` for the HTTP handler and the socket handler: an error whose keelwerk cause is internal is logged once, with
 * the request id and its code, and nothing else is.
 */
export function trpcErrorLogger(
  log: Logger,
  requestId: string,
): (failure: { readonly error: TRPCError }) => void {
  return ({ error }) => {
    const cause = keelwerkErrorOfTrpc(error);
    if (cause.kind === 'internal') {
      log.error('The tRPC request failed.', {
        requestId,
        code: cause.code,
        cause: cause.cause ?? error.cause,
      });
    }
  };
}
