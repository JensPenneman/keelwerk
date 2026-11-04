import type { AnyField } from './field.ts';
import type { ShapeValue } from './shape-value.ts';
import type { StandardSchemaV1 } from './standard-schema.ts';

/** The fields of a shape. */
export type ShapeFields = { readonly [name: string]: AnyField };

/** An object schema built from fields: a Standard Schema that transports can walk (section 4.2). */
export interface Shape<F extends ShapeFields = ShapeFields>
  extends StandardSchemaV1<ShapeValue<F, string, 'input'>, ShapeValue<F, string, 'stored'>> {
  readonly kind: 'shape';
  readonly fields: F;
}

/** Builds an object schema from fields; the spike validates nothing at runtime. */
export function shape<const F extends ShapeFields>(fields: F): Shape<F> {
  return {
    kind: 'shape',
    fields,
    '~standard': {
      version: 1,
      vendor: 'keelwerk',
      validate: (value) => ({ value: value as ShapeValue<F, string, 'stored'> }),
    },
  };
}
