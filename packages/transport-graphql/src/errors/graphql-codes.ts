import type { ErrorKind } from '@keelwerk/core';

/** The `extensions.code` of each error kind (the GraphQL column of section 16.4.6). */
export const graphqlCodes: Readonly<Record<ErrorKind, string>> = {
  validation: 'BAD_USER_INPUT',
  unauthenticated: 'UNAUTHENTICATED',
  forbidden: 'FORBIDDEN',
  // biome-ignore lint/style/useNamingConvention: the key is an error kind of the taxonomy
  not_found: 'NOT_FOUND',
  conflict: 'CONFLICT',
  // biome-ignore lint/style/useNamingConvention: the key is an error kind of the taxonomy
  rate_limited: 'RATE_LIMITED',
  // biome-ignore lint/style/useNamingConvention: the key is an error kind of the taxonomy
  not_implemented: 'NOT_IMPLEMENTED',
  unavailable: 'UNAVAILABLE',
  unsupported: 'UNSUPPORTED',
  internal: 'INTERNAL_SERVER_ERROR',
};
