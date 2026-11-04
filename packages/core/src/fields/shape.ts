import type { AnyField } from './field-def.ts';
import type { ShapeValue } from './shape-value.ts';
import type { StandardIssue, StandardResult, StandardSchemaV1 } from './standard-schema-v1.ts';
import { validateValue } from './validate-value.ts';

function validateShape<F extends ShapeFields>(
  fields: F,
  value: unknown,
): StandardResult<ShapeValue<F, string, 'value'>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { issues: [{ message: 'expected an object' }] };
  }
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

/** The fields of a shape. */
export type ShapeFields = { readonly [name: string]: AnyField };

/** An object schema built from fields: a Standard Schema that transports can walk (section 4.2). */
export interface Shape<F extends ShapeFields = ShapeFields>
  extends StandardSchemaV1<ShapeValue<F, string, 'input'>, ShapeValue<F, string, 'value'>> {
  readonly kind: 'shape';
  readonly fields: F;
}

/**
 * Builds an object schema from fields. Its `~standard.validate` checks every field with
 * `validateValue`, fills defaults and rejects names that are not fields.
 */
export function shape<const F extends ShapeFields>(fields: F): Shape<F> {
  return {
    kind: 'shape',
    fields,
    '~standard': {
      version: 1,
      vendor: 'keelwerk',
      validate: (value) => validateShape(fields, value),
    },
  };
}
