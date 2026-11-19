import type { ErrorKind, KeelwerkError } from '@keelwerk/core';
import type { TRPC_ERROR_CODE_KEY } from '@trpc/server';

const byKind: Readonly<Record<ErrorKind, TRPC_ERROR_CODE_KEY>> = {
  validation: 'BAD_REQUEST',
  unauthenticated: 'UNAUTHORIZED',
  forbidden: 'FORBIDDEN',
  // biome-ignore lint/style/useNamingConvention: the key is the kind of section 10
  not_found: 'NOT_FOUND',
  conflict: 'CONFLICT',
  // biome-ignore lint/style/useNamingConvention: the key is the kind of section 10
  rate_limited: 'TOO_MANY_REQUESTS',
  // biome-ignore lint/style/useNamingConvention: the key is the kind of section 10
  not_implemented: 'NOT_IMPLEMENTED',
  unavailable: 'SERVICE_UNAVAILABLE',
  unsupported: 'UNPROCESSABLE_CONTENT',
  internal: 'INTERNAL_SERVER_ERROR',
};

/** The tRPC code of an error (the tRPC column of section 16.4.6): the kind's, and `PRECONDITION_FAILED` for a failed precondition. */
export function trpcCodeOf(error: Pick<KeelwerkError, 'kind' | 'code'>): TRPC_ERROR_CODE_KEY {
  if (
    error.kind === 'conflict' &&
    (error.code === 'core.version_mismatch' || error.code === 'core.state_mismatch')
  ) {
    return 'PRECONDITION_FAILED';
  }
  return byKind[error.kind];
}
