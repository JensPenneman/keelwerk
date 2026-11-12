import type { ShapeFields } from './shape.ts';
import type { ShapeValue } from './shape-value.ts';
import type {
  StandardIssue,
  StandardResult,
  StandardValidateOptions,
} from './standard-schema-v1.ts';
import { validateValue } from './validate-value.ts';

/**
 * Validates an object against the fields of a shape. The `keelwerkWrite` library option marks an
 * input or a draft about to be written (see `writeValidation`): a subject id is then refused unless
 * it is in lower case, here and in every nested shape.
 */
export function validateShape<F extends ShapeFields>(
  fields: F,
  value: unknown,
  options: StandardValidateOptions | undefined,
): StandardResult<ShapeValue<F, string, 'value'>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { issues: [{ message: 'expected an object' }] };
  }
  const write = Reflect.get(options?.libraryOptions ?? {}, 'keelwerkWrite') === true;
  const issues: StandardIssue[] = [];
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(value)) {
    if (!Object.hasOwn(fields, name)) {
      issues.push({ message: 'is not a field of this shape', path: [name] });
    }
  }
  for (const [name, member] of Object.entries(fields)) {
    const result = validateValue(
      member,
      Object.hasOwn(value, name) ? Reflect.get(value, name) : undefined,
      { write },
    );
    if (result.issues !== undefined) {
      issues.push(
        ...result.issues.map((issue) => ({ ...issue, path: [name, ...(issue.path ?? [])] })),
      );
    } else if (result.value !== undefined) {
      out[name] = result.value;
    }
  }
  return issues.length > 0 ? { issues } : { value: out as ShapeValue<F, string, 'value'> };
}
