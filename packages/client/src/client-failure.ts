import type { ErrorIssue, ErrorKind } from '@keelwerk/core';
import { ClientError } from './client-error.ts';

type ClientFailureCode =
  | 'core.unavailable'
  | 'core.live_unavailable'
  | 'core.internal'
  | 'core.not_found'
  | 'core.validation'
  | 'core.unsupported';

const kinds: Readonly<Record<ClientFailureCode, ErrorKind>> = {
  'core.unavailable': 'unavailable',
  'core.live_unavailable': 'unavailable',
  'core.internal': 'internal',
  'core.not_found': 'not_found',
  'core.validation': 'validation',
  'core.unsupported': 'unsupported',
};

/** A taxonomy error raised by the client itself: a network failure, an unreadable answer, a missing live module. */
export function clientFailure(
  code: ClientFailureCode,
  message: string,
  extra: { readonly cause?: unknown; readonly issues?: readonly ErrorIssue[] } = {},
): ClientError {
  return new ClientError({
    kind: kinds[code],
    code,
    message,
    ...(extra.cause !== undefined && { cause: extra.cause }),
    ...(extra.issues !== undefined && { issues: extra.issues }),
  });
}
