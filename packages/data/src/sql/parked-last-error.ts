import type { ErrorKind, WireError } from '@keelwerk/core';

/** The error a parked stream answers: its stored kind and code, the other required members empty. */
export function parkedLastError(stored: {
  readonly kind: ErrorKind;
  readonly code: string;
}): WireError {
  return { kind: stored.kind, code: stored.code, message: '', retryable: false, requestId: '' };
}
