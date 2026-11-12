import { patchFieldOf } from './patch-field-of.ts';
import type { Shape, ShapeFields } from './shape.ts';
import { validateShape } from './validate-shape.ts';

/** Keeps the own entries of an object that are not `undefined`; any other value is returned as it is. */
function named(value: unknown): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter(([, member]) => member !== undefined))
    : value;
}

/**
 * The object schema of a patch (section 6.7): `fields` holds every member made optional and
 * without its default (`patchFieldOf`); a member the value names is checked as `shape` checks it,
 * a member that is absent or `undefined` stays absent, and a name that is no member is refused.
 */
export function patchShape(fields: ShapeFields): Shape {
  const members = Object.fromEntries(
    Object.entries(fields).map(([name, member]) => [name, patchFieldOf(member)]),
  );
  return {
    kind: 'shape',
    fields: members,
    '~standard': {
      version: 1,
      vendor: 'keelwerk',
      validate: (value, options) => validateShape(members, named(value), options),
    },
  };
}
