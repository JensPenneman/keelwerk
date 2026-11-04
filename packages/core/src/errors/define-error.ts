import type { StandardOutput, StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import { createError } from './create-error.ts';
import type { ErrorDefinition } from './error-definition.ts';
import type { ErrorSpec } from './error-spec.ts';
import type { ErrorThrowOptions } from './error-throw-options.ts';

const codePattern = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*\.[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/**
 * Declares a domain error under a code of the form `<module>.<snake_case>` (section 10). The code
 * is part of the public contract and never reused; a code of another shape throws a `TypeError`.
 * The `data` schema types the details; validating them is the pipeline's job when the error is thrown.
 */
export function defineError<
  const Code extends string,
  Schema extends StandardSchemaV1 | undefined = undefined,
>(
  code: Code,
  spec: ErrorSpec & { readonly data?: Schema },
): ErrorDefinition<Code, Schema extends StandardSchemaV1 ? StandardOutput<Schema> : undefined> {
  if (!codePattern.test(code)) {
    throw new TypeError(`Error code "${code}" must have the form <module>.<snake_case>.`);
  }
  const hasData = spec.data !== undefined;
  const build = (...args: readonly unknown[]) => {
    const options = (hasData ? args[1] : args[0]) as ErrorThrowOptions | undefined;
    return createError(
      spec.kind,
      code,
      spec.message,
      hasData ? args[0] : undefined,
      options ?? {},
      spec.retryable,
    );
  };
  return Object.assign(build, { code, spec }) as ErrorDefinition<
    Code,
    Schema extends StandardSchemaV1 ? StandardOutput<Schema> : undefined
  >;
}
