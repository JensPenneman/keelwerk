import type { ErrorKind, WireError } from '@keelwerk/core';
import { errors, isErrorCode } from '@keelwerk/core';

/**
 * What a parked stream keeps of its error (15.2.3, D7): the kind and the code. A message can repeat
 * a personal value, so nothing else is stored; a code that is not of the registered stable form (free
 * text) is refused, and a kind outside the taxonomy of section 10 is stored as `internal`, so no free
 * text reaches `last_error` through either.
 */
export function parkedErrorOf(error: WireError): {
  readonly kind: ErrorKind;
  readonly code: string;
} {
  if (!isErrorCode(error.code)) {
    throw errors.validation(
      'a parked stream keeps an error code of the form <module>.<snake_case>',
    );
  }
  return { kind: Object.hasOwn(errors, error.kind) ? error.kind : 'internal', code: error.code };
}
