import { pascal, type SurfaceEntity } from '@keelwerk/core';

/**
 * The object field beside a to-one reference field (decision D1 of the work package): `bookId`
 * gets `book`, any other reference field `x` gets `x` plus the Pascal name of the target entity
 * (`relatedTo` gets `relatedToBook`).
 */
export function referenceFieldName(field: string, target: SurfaceEntity): string {
  return field.length > 2 && field.endsWith('Id')
    ? field.slice(0, -2)
    : `${field}${pascal(target.name)}`;
}
