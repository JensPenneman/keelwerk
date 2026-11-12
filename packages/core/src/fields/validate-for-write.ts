import type { StandardResult, StandardSchemaV1 } from './standard-schema-v1.ts';
import { writeValidation } from './write-validation.ts';

/**
 * Validates an input or a draft that is about to be written: the schema's own `~standard.validate`
 * answers, with the write options. A shape then also refuses a subject id that is not in lower
 * case, at every depth, which its validate without them (used for outputs, stored values and every
 * other read) never does; any other schema answers as it does everywhere.
 */
export function validateForWrite<T>(
  schema: StandardSchemaV1<unknown, T>,
  value: unknown,
): StandardResult<T> | Promise<StandardResult<T>> {
  return schema['~standard'].validate(value, writeValidation);
}
