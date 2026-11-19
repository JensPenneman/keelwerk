import type { KeelwerkError } from '@keelwerk/core';
import { TRPCError } from '@trpc/server';
import { trpcCodeOf } from './trpc-code-of.ts';

/** The `TRPCError` of a taxonomy error: the code of section 16.4.6, the error itself as the cause the formatter reads back. */
export function trpcErrorOf(error: KeelwerkError): TRPCError {
  return new TRPCError({ code: trpcCodeOf(error), message: error.message, cause: error });
}
