import type { ErrorKind } from './error-kind.ts';
import type { ErrorThrowOptions } from './error-throw-options.ts';
import type { KeelwerkError } from './keelwerk-error.ts';

/** One builder per kind of the taxonomy: `throw errors.forbidden('Self-registration is disabled.')`. */
export type ErrorFactories = {
  readonly [Kind in ErrorKind]: (message: string, options?: ErrorThrowOptions) => KeelwerkError;
};
