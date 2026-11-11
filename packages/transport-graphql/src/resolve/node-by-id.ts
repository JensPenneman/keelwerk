import { pascal } from '@keelwerk/core';
import { projectedGetOf } from '../schema/projected-get-of.ts';
import type { GraphqlContext } from './graphql-context.ts';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The entity row a TypeID names, read through the entity's own `get` and the request's loader (so
 * every `node` and `nodes` of one execution level is one invocation per entity). The entity comes
 * from the TypeID prefix (prefixes are unique per app, section 5.1); an unknown prefix, an entity
 * without `get` and a row the caller may not see are all `null`.
 */
export async function nodeById(context: GraphqlContext, id: string): Promise<unknown> {
  const separator = id.lastIndexOf('_');
  if (separator <= 0) return null;
  const prefix = id.slice(0, separator);
  const entity = context.surface.entities.find((candidate) => candidate.prefix === prefix);
  if (entity === undefined) return null;
  if (projectedGetOf(context.surface, entity.ref) === undefined) return null;
  const row = await context.loaderOf(entity.ref).load(id);
  return isRecord(row) ? { __typename: pascal(entity.ref), ...row } : null;
}
