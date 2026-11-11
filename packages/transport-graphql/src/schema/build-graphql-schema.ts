import type { ApiSurface } from '@keelwerk/core';
import { inspectGraphqlSurface } from '../check/inspect-graphql-surface.ts';
import { assertValidSchema } from './assert-valid-schema.ts';
import type { GraphqlProjection } from './graphql-projection.ts';

/**
 * The GraphQL schema of a surface (section 16.6.1): an object type per entity, a root field per
 * query and command, `node` and `nodes`, and the fixed types. Pure: the same surface gives the
 * same schema, and `printSchema(lexicographicSortSchema(schema))` is the same whatever the order of
 * modules, entities, actions or fields. Throws a `TypeError` for the first problem
 * `checkGraphqlSurface` finds, and for a schema that does not validate.
 */
export function buildGraphqlSchema(surface: ApiSurface): GraphqlProjection {
  const inspection = inspectGraphqlSurface(surface);
  const refused = inspection.problems[0];
  if (refused !== undefined) {
    throw new TypeError(`${refused.code}: ${refused.subject}: ${refused.message}`);
  }
  if (inspection.projection === undefined) {
    throw new TypeError('The GraphQL schema of this surface was not built.');
  }
  assertValidSchema(inspection.projection);
  return inspection.projection;
}
