import { isKeelwerkError } from '@keelwerk/core';

/** What a failed scope leaves in its run: the kind and code of the error, never its message or a value. */
export function retentionRunError(error: unknown): {
  readonly kind: string;
  readonly code: string;
} {
  return isKeelwerkError(error)
    ? { kind: error.kind, code: error.code }
    : { kind: 'internal', code: 'core.internal' };
}
