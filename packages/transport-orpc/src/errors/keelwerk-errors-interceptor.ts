import type { KeelwerkError, WireError } from '@keelwerk/core';
import { asKeelwerkError, coreError } from '@keelwerk/core/http';
import { isErrorKind } from '@keelwerk/core/wire';
import { ORPCError } from '@orpc/server';
import type { RPCHandlerOptions } from '@orpc/server/fetch';
import type { OrpcContext } from '../router/orpc-context.ts';
import { orpcErrorOf } from './orpc-error-of.ts';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether an oRPC error already carries the wire error of section 16.4.6 as its data: this package built it. */
function carriesWireError(
  error: ORPCError<string, unknown>,
): error is ORPCError<string, WireError> {
  const data: unknown = error.data;
  return (
    isRecord(data) &&
    isErrorKind(data.kind) &&
    typeof data.code === 'string' &&
    typeof data.requestId === 'string'
  );
}

/**
 * What an error oRPC raised itself becomes in the taxonomy, with the status it keeps. A procedure of
 * this package only ever throws an oRPC error, so a plain error reaching the interceptor before the
 * procedure began (`entered` is not set) comes from oRPC's own matching or decoding of the request,
 * which wraps it as `BAD_REQUEST` only after the interceptors ran: a body that is no JSON is a
 * `SyntaxError` and serialised data that does not fit its type is a `TypeError`. A plain error after
 * the procedure began comes from the encoding of its output and is internal.
 */
function mapped(
  thrown: unknown,
  entered: boolean,
): { readonly error: KeelwerkError; readonly status?: number } {
  if (thrown instanceof ORPCError) {
    switch (thrown.code) {
      case 'BAD_REQUEST':
        return { error: coreError('core.malformed_request') };
      case 'METHOD_NOT_SUPPORTED':
        return {
          error: coreError('core.unsupported', { message: 'This endpoint takes POST requests.' }),
          status: 405,
        };
      case 'NOT_FOUND':
        return { error: coreError('core.not_found') };
      default:
        break;
    }
  }
  if (!entered && (thrown instanceof SyntaxError || thrown instanceof TypeError)) {
    return { error: coreError('core.malformed_request') };
  }
  return { error: asKeelwerkError(thrown) };
}

/**
 * The handler interceptor of both handlers (section 16.7.7): an error this package raised passes,
 * and every other error becomes one of the taxonomy, so no answer lacks the wire error. oRPC's
 * own refusals map to `core.malformed_request`, `core.unsupported` (status 405) and
 * `core.not_found`, and so does a plain `SyntaxError` or `TypeError` of the request's decoding
 * (`core.malformed_request`); anything else, a plain error after the procedure began included, is
 * internal, logged once with its cause.
 */
export const keelwerkErrorsInterceptor: NonNullable<
  RPCHandlerOptions<OrpcContext>['interceptors']
>[number] = async ({ next, context }) => {
  try {
    return await next();
  } catch (thrown) {
    if (thrown instanceof ORPCError && carriesWireError(thrown)) throw thrown;
    const { error, status } = mapped(thrown, context.answer.entered === true);
    throw orpcErrorOf(error, context, status);
  }
};
