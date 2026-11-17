import type { ErrorKind } from './error-kind.ts';
import { errorKinds } from './error-kinds.ts';

/** Whether `value` is one of the kinds of the closed taxonomy of section 10. */
export function isErrorKind(value: unknown): value is ErrorKind {
  return typeof value === 'string' && (errorKinds as readonly string[]).includes(value);
}
