import type { ErrorKind } from './error-kind.ts';

/**
 * Every kind of the taxonomy: `satisfies` makes a kind added to `ErrorKind` and missing here fail
 * to compile.
 */
const errorKinds = {
  validation: true,
  unauthenticated: true,
  forbidden: true,
  // biome-ignore lint/style/useNamingConvention: the key is the kind of section 10
  not_found: true,
  conflict: true,
  // biome-ignore lint/style/useNamingConvention: the key is the kind of section 10
  rate_limited: true,
  // biome-ignore lint/style/useNamingConvention: the key is the kind of section 10
  not_implemented: true,
  unavailable: true,
  unsupported: true,
  internal: true,
} as const satisfies Record<ErrorKind, true>;

/** Whether `value` is one of the kinds of the closed taxonomy of section 10. */
export function isErrorKind(value: unknown): value is ErrorKind {
  return typeof value === 'string' && Object.hasOwn(errorKinds, value);
}
