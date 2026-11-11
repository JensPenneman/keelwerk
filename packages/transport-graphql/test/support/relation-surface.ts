import type { ApiSurface } from '@keelwerk/core';
import { transportSurface } from './graphql-kit.ts';

/**
 * The transport surface with a to-many relation on the book: `loans`, the loans whose `bookId` is
 * the book (the fixture entities declare no relation, so the surface is built by hand).
 */
export function relationSurface(): ApiSurface {
  const surface = transportSurface();
  return {
    ...surface,
    entities: surface.entities.map((entity) =>
      entity.ref === 'library.book'
        ? { ...entity, relations: { loans: { kind: 'many', target: 'loans.loan', by: 'bookId' } } }
        : entity,
    ),
  };
}
