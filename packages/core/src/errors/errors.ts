import { createError } from './create-error.ts';
import type { ErrorFactories } from './error-factories.ts';
import type { ErrorKind } from './error-kind.ts';
import type { ErrorThrowOptions } from './error-throw-options.ts';
import type { KeelwerkError } from './keelwerk-error.ts';

function factory(kind: ErrorKind): (message: string, options?: ErrorThrowOptions) => KeelwerkError {
  return (message, options) => createError(kind, `core.${kind}`, message, undefined, options ?? {});
}

/** The kind-level builders of the taxonomy; each error carries the code `core.<kind>`. */
export const errors: ErrorFactories = Object.freeze({
  validation: factory('validation'),
  unauthenticated: factory('unauthenticated'),
  forbidden: factory('forbidden'),
  // biome-ignore lint/style/useNamingConvention: the key is the kind of section 10
  not_found: factory('not_found'),
  conflict: factory('conflict'),
  // biome-ignore lint/style/useNamingConvention: the key is the kind of section 10
  rate_limited: factory('rate_limited'),
  // biome-ignore lint/style/useNamingConvention: the key is the kind of section 10
  not_implemented: factory('not_implemented'),
  unavailable: factory('unavailable'),
  unsupported: factory('unsupported'),
  internal: factory('internal'),
});
