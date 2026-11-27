import type { Mark } from './mark-types.ts';
import { marksOfMember } from './marks-of-member.ts';
import type { ShapeFields } from './shape.ts';

/** Every mark of a shape or an entity (a schema with no declared fields holds none). */
export function marksOfShape(schema: object): readonly Mark[] {
  const { fields } = schema as { readonly fields?: ShapeFields };
  return Object.entries(fields ?? {}).flatMap(([name, field]) => marksOfMember(field, name));
}
