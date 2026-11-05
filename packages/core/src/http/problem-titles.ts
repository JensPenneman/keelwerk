import type { ErrorKind } from '../errors/error-kind.ts';

/** The title of an RFC 9457 problem document for each error kind (section 16.5.4). */
export const problemTitles: Readonly<Record<ErrorKind, string>> = {
  validation: 'Validation',
  unauthenticated: 'Unauthenticated',
  forbidden: 'Forbidden',
  // biome-ignore lint/style/useNamingConvention: the key is the kind of section 10
  not_found: 'Not found',
  conflict: 'Conflict',
  // biome-ignore lint/style/useNamingConvention: the key is the kind of section 10
  rate_limited: 'Rate limited',
  // biome-ignore lint/style/useNamingConvention: the key is the kind of section 10
  not_implemented: 'Not implemented',
  unavailable: 'Unavailable',
  unsupported: 'Unsupported',
  internal: 'Internal error',
};
