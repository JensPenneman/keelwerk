import { KeelwerkError } from '@keelwerk/core';

/** The code of an error for a log line: a `KeelwerkError`'s own, else `unknown`; never its message or cause. */
export function logCodeOf(error: unknown): string {
  return error instanceof KeelwerkError ? error.code : 'unknown';
}
