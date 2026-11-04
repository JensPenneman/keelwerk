import type { AnyField } from '../fields/field-def.ts';
import { type Shape, shape } from '../fields/shape.ts';
import { systemFieldDefs } from './system-field-defs.ts';

/** The shape of a row as a caller receives it: the entity's fields and the system fields. */
export function rowShape(fields: Readonly<Record<string, AnyField>>): Shape {
  return shape({ ...systemFieldDefs(), ...fields });
}
