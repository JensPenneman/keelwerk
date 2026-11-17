import type { ErrorKind } from './error-kind.ts';

/** Each kind once; `satisfies` makes a kind added to `ErrorKind` and missing here fail to compile. */
const members = {
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

/** Every kind of the closed taxonomy of section 10, in its order: the one list the layers share. */
export const errorKinds: readonly ErrorKind[] = Object.freeze(Object.keys(members) as ErrorKind[]);
