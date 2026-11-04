import { errors } from '../errors/errors.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import { issuesOf } from '../invoker/stages/issues-of.ts';

/**
 * Validates an input module code handed to an effect against the schema of what it names; the
 * schemas of shapes are synchronous. A failure is `validation`, with the issues. Answers the
 * value the schema produced (defaults filled).
 */
export function validateEffectInput(
  schema: StandardSchemaV1,
  input: unknown,
  what: string,
): unknown {
  const result = schema['~standard'].validate(input);
  if (result instanceof Promise) {
    throw errors.internal(`the input of ${what} has an asynchronous schema`);
  }
  if (result.issues === undefined) return result.value;
  throw errors.validation(`The input of ${what} is not valid.`, {
    issues: issuesOf(result.issues),
  });
}
