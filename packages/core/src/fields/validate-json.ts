import type { StandardResult } from './standard-schema-v1.ts';
import { writeValidation } from './write-validation.ts';

type Outcome = StandardResult<unknown>;

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null;

/**
 * Validates the value of a `json` field against its schema through the schema's own
 * `~standard.validate`; a write passes `writeValidation`, so a keelwerk shape checks a nested
 * subject as a write is checked.
 */
export function validateJson(schema: unknown, value: unknown, write: boolean): Outcome {
  const standard = isObject(schema) ? Reflect.get(schema, '~standard') : undefined;
  const validate: unknown = isObject(standard) ? Reflect.get(standard, 'validate') : undefined;
  if (typeof validate !== 'function') {
    return { issues: [{ message: 'the field has no schema' }] };
  }
  const result = validate.call(standard, value, write ? writeValidation : undefined) as
    | Outcome
    | Promise<Outcome>;
  return result instanceof Promise
    ? { issues: [{ message: 'asynchronous schemas are not supported' }] }
    : result;
}
