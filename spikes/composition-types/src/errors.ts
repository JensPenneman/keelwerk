import type { ErrorKind, KeelwerkError } from './define-error.ts';

function coreError(code: string, errorKind: ErrorKind): (message: string) => KeelwerkError {
  return (message) => Object.assign(new Error(message), { code, errorKind, data: undefined });
}

/** The core's error constructors of the taxonomy. */
export interface CoreErrors {
  forbidden(message: string): KeelwerkError<'core.forbidden'>;
  invalid(message: string): KeelwerkError<'core.invalid'>;
  notFound(message: string): KeelwerkError<'core.not_found'>;
  conflict(message: string): KeelwerkError<'core.conflict'>;
  unavailable(message: string): KeelwerkError<'core.unavailable'>;
}

/** `throw errors.forbidden('...')` (section 10). */
export const errors: CoreErrors = {
  forbidden: (message) =>
    coreError('core.forbidden', 'forbidden')(message) as KeelwerkError<'core.forbidden'>,
  invalid: (message) =>
    coreError('core.invalid', 'invalid')(message) as KeelwerkError<'core.invalid'>,
  notFound: (message) =>
    coreError('core.not_found', 'not_found')(message) as KeelwerkError<'core.not_found'>,
  conflict: (message) =>
    coreError('core.conflict', 'conflict')(message) as KeelwerkError<'core.conflict'>,
  unavailable: (message) =>
    coreError('core.unavailable', 'unavailable')(message) as KeelwerkError<'core.unavailable'>,
};
