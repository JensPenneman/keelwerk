import type { GraphQLFieldResolver } from 'graphql';
import type { GraphqlContext } from './graphql-context.ts';

/**
 * The resolver of the object field beside a to-one reference field: the id comes from the encoded
 * row, so a masked reference is `null` (also if the row still held its id) and is never read from
 * anywhere else, and the row from the request's loader of the target entity.
 */
export function referenceResolver(
  field: string,
  target: string,
): GraphQLFieldResolver<Readonly<Record<string, unknown>>, GraphqlContext> {
  return (source, _args, context) => {
    const id = source[field];
    const masked = Array.isArray(source.$masked) && source.$masked.includes(field);
    return typeof id === 'string' && !masked ? context.loaderOf(target).load(id) : null;
  };
}
