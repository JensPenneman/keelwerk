import { errors, isKeelwerkError, type KeelwerkError } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import type { TRPCError } from '@trpc/server';

/**
 * The taxonomy error behind a `TRPCError`: the cause when it is one, else the error of the code
 * tRPC itself raised (a parse failure, an unknown path, a refused method), with tRPC's message, which
 * speaks only of the request. Anything else is `internal`, and tRPC's message is never passed on.
 */
export function keelwerkErrorOfTrpc(error: TRPCError): KeelwerkError {
  if (isKeelwerkError(error.cause)) return error.cause;
  switch (error.code) {
    case 'PARSE_ERROR':
    case 'BAD_REQUEST':
      return coreError('core.malformed_request', { message: error.message });
    case 'NOT_FOUND':
      return coreError('core.not_found', { message: error.message });
    case 'METHOD_NOT_SUPPORTED':
    case 'UNSUPPORTED_MEDIA_TYPE':
      return coreError('core.unsupported', { message: error.message });
    case 'PAYLOAD_TOO_LARGE':
      return coreError('core.payload_too_large', { message: error.message });
    default:
      return errors.internal('The request failed.', { cause: error });
  }
}
