import type { AnyField } from './field-def.ts';
import type { ShapeFields } from './shape.ts';

/**
 * The member fields of a `json` field over a keelwerk shape (`field.json(shape({ ... }))`); a field
 * of another kind and a `json` field over any other schema have none.
 */
export function jsonShapeFields(field: AnyField): ShapeFields | undefined {
  if (field.kind !== 'json') return undefined;
  const { options } = field;
  if (typeof options !== 'object' || options === null || Array.isArray(options)) return undefined;
  if (Reflect.get(options, 'kind') !== 'shape') return undefined;
  const fields: unknown = Reflect.get(options, 'fields');
  return typeof fields === 'object' && fields !== null ? (fields as ShapeFields) : undefined;
}
