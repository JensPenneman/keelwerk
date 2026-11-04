import type { ErrorSpec } from './error-spec.ts';
import type { ErrorThrowOptions } from './error-throw-options.ts';
import type { KeelwerkError } from './keelwerk-error.ts';

/**
 * What `defineError` returns: a function that builds the error (`throw emailTaken({ email })`),
 * carrying its code and spec. `Details` is `undefined` when the spec declares no `data` schema.
 */
export interface ErrorDefinition<Code extends string = string, Details = undefined> {
  (
    ...args: [Details] extends [undefined]
      ? [options?: ErrorThrowOptions]
      : [details: Details, options?: ErrorThrowOptions]
  ): KeelwerkError;
  readonly code: Code;
  readonly spec: ErrorSpec;
}

/** Any definition, with or without a data schema: the element type of a list such as `errors: [...]`. */
export interface AnyErrorDefinition {
  (...args: never[]): KeelwerkError;
  readonly code: string;
  readonly spec: ErrorSpec;
}
