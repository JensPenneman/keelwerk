import { type KeelwerkError, toWire, type WireError } from '@keelwerk/core';
import { audienceOf, statusOfError } from '@keelwerk/core/http';
import { toWire as toWireValue } from '@keelwerk/core/wire';
import { ORPCError } from '@orpc/server';
import type { OrpcContext } from '../router/orpc-context.ts';
import { nativeOfWire } from '../wire/native-of-wire.ts';

type ErrorContext = Pick<
  OrpcContext,
  'session' | 'development' | 'requestId' | 'log' | 'surface' | 'wire' | 'answer'
>;

/** The details of a declared error as the wire shows them; the details as they are when the error declares no data or they do not fit it. */
function detailsOf(error: KeelwerkError, context: ErrorContext): unknown {
  const node = context.surface.errors.find((candidate) => candidate.code === error.code)?.data;
  if (node === undefined) return error.details;
  try {
    const encoded = toWireValue(node, error.details);
    return context.wire === 'orpc' ? nativeOfWire(node, encoded) : encoded;
  } catch {
    return error.details;
  }
}

/**
 * The oRPC error of a taxonomy error (section 16.7.7): its code is the error's code, its status the
 * error's status (or `status`), its message the audience's message and its data the audience's wire
 * error with the request id. The `details` of a declared error are encoded by the error's data
 * node. An internal error is logged once with its cause; the answer carries neither stack nor
 * cause. The error is also kept in `context.answer`, for the headers of the response.
 */
export function orpcErrorOf(
  error: KeelwerkError,
  context: ErrorContext,
  status: number = statusOfError(error),
): ORPCError<string, WireError> {
  if (error.kind === 'internal') {
    context.log.error('The oRPC request failed.', {
      requestId: context.requestId,
      code: error.code,
      cause: error.cause,
    });
  }
  const wire = toWire(error, audienceOf(context.session, context.development));
  const details = wire.details === undefined ? undefined : detailsOf(error, context);
  context.answer.failure = error;
  return new ORPCError(error.code, {
    status,
    message: wire.message,
    data: {
      ...wire,
      ...(details === undefined ? {} : { details }),
      requestId: context.requestId,
    },
  });
}
