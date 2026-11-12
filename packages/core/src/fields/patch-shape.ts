import type { Shape, ShapeFields } from './shape.ts';
import { shape } from './shape.ts';

/**
 * The object schema of a patch (section 6.7): `fields` holds every member made optional; a member
 * the value names is checked as `shape` checks it, a member that is absent or `undefined` stays
 * absent (no default is filled in), and a name that is no member is refused.
 */
export function patchShape(fields: ShapeFields): Shape {
  const optional = Object.fromEntries(
    Object.entries(fields).map(([name, member]) => [
      name,
      member.flags.optional ? member : member.optional(),
    ]),
  );
  return {
    kind: 'shape',
    fields: optional,
    '~standard': {
      version: 1,
      vendor: 'keelwerk',
      validate: (value) => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          return shape(optional)['~standard'].validate(value);
        }
        const named = Object.entries(value).filter(([, member]) => member !== undefined);
        const present = Object.fromEntries(named);
        const members = Object.fromEntries(
          Object.entries(optional).filter(([name]) => Object.hasOwn(present, name)),
        );
        return shape(members)['~standard'].validate(present);
      },
    },
  };
}
