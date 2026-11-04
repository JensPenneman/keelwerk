import type { Shape, ShapeFields } from './shape.ts';
import type { ShapeValue } from './shape-value.ts';

function errorFactory(
  code: string,
  errorKind: ErrorKind,
  message: string,
): (data?: unknown) => KeelwerkError {
  return (data) => Object.assign(new Error(message), { code, errorKind, data });
}

/** Error kinds of the taxonomy (section 10). */
export type ErrorKind =
  | 'invalid'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'unavailable'
  | 'internal';

/** A thrown keelwerk error. */
export interface KeelwerkError<C extends string = string> extends Error {
  readonly code: C;
  readonly errorKind: ErrorKind;
  readonly data: unknown;
}

/** What every declared error carries. */
export interface ErrorSpecBase<C extends string, D> {
  readonly kind: 'error';
  readonly code: C;
  readonly errorKind: ErrorKind;
  readonly message: string;
  readonly '~data'?: D;
}

/** A declared error with data: `emailTaken({ email })`. */
export interface ErrorSpecWithData<C extends string, D> extends ErrorSpecBase<C, D> {
  (data: D): KeelwerkError<C>;
}

/** A declared error without data: `invalidCredentials()`. */
export interface ErrorSpecNoData<C extends string> extends ErrorSpecBase<C, undefined> {
  (): KeelwerkError<C>;
}

/** Any declared error. */
export type AnyErrorSpec = ErrorSpecBase<string, unknown>;

/** Declares a domain error with a stable code (section 10); `data` types the call. */
export function defineError<const C extends string, const F extends ShapeFields = never>(
  code: C,
  spec: { readonly kind: ErrorKind; readonly message: string; readonly data?: Shape<F> },
): [F] extends [never] ? ErrorSpecNoData<C> : ErrorSpecWithData<C, ShapeValue<F, string, 'draft'>> {
  return Object.assign(errorFactory(code, spec.kind, spec.message), {
    kind: 'error' as const,
    code,
    errorKind: spec.kind,
    message: spec.message,
  }) as unknown as [F] extends [never]
    ? ErrorSpecNoData<C>
    : ErrorSpecWithData<C, ShapeValue<F, string, 'draft'>>;
}
