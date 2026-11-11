import {
  type ApiSurface,
  type MountContext,
  type SelectionLimits,
  type VersionProjection,
  versionProjection,
} from '@keelwerk/core';
import { createYoga } from 'graphql-yoga';
import { inspectGraphqlSurface } from '../check/inspect-graphql-surface.ts';
import { keelwerkErrorsPlugin } from '../errors/keelwerk-errors-plugin.ts';
import type { GraphqlConfig } from '../graphql-config.ts';
import type { GraphqlStaticOptions } from '../graphql-static-options.ts';
import { preparedDocumentsPlugin } from '../request/prepared-documents-plugin.ts';
import type { GraphqlContext } from '../resolve/graphql-context.ts';
import { assertValidSchema } from '../schema/assert-valid-schema.ts';
import { endpointHeader } from './endpoint-header.ts';
import type { GraphqlVersionMount } from './graphql-version-mount.ts';

function mountOf(
  surface: ApiSurface,
  development: boolean,
  limits: SelectionLimits,
): GraphqlVersionMount {
  const inspection = inspectGraphqlSurface(surface);
  const refused = inspection.problems[0];
  if (refused !== undefined) {
    throw new TypeError(
      `${refused.code}: ${refused.subject}: ${refused.message} (API version ${surface.apiVersion})`,
    );
  }
  const projection = inspection.projection;
  if (projection === undefined) {
    throw new TypeError(`The GraphQL schema was not built (API version ${surface.apiVersion}).`);
  }
  assertValidSchema(projection);
  const yoga = createYoga<Record<string, unknown>, GraphqlContext>({
    schema: projection.schema,
    graphqlEndpoint: '/graphql',
    batching: { limit: limits.operations },
    graphiql: development
      ? (request) => ({ endpoint: request.headers.get(endpointHeader) ?? '/graphql' })
      : false,
    landingPage: false,
    cors: false,
    logging: false,
    maskedErrors: { isDev: false },
    parserAndValidationCache: false,
    plugins: [preparedDocumentsPlugin((context) => context.documents), keelwerkErrorsPlugin()],
  });
  return { surface, projection, yoga };
}

/**
 * The GraphQL mount of each API version (section 18.2): the schema and Yoga instance of the surface
 * at that version, checked and built for every declared version at mount, so a version whose
 * surface the GraphQL check refuses fails at start. A context without `surfaces` (a hand-built one)
 * serves its one surface at every version.
 */
export function graphqlVersionMounts(
  ctx: MountContext<GraphqlConfig>,
  _options: GraphqlStaticOptions,
  limits: SelectionLimits,
): VersionProjection<GraphqlVersionMount> {
  const development = ctx.development === true;
  if (ctx.surfaces !== undefined) {
    const { surfaces } = ctx;
    const mounts = versionProjection(surfaces.versions, (version) =>
      mountOf(surfaces.at(version), development, limits),
    );
    for (const version of mounts.versions) mounts.at(version);
    return mounts;
  }
  const head = mountOf(ctx.surface, development, limits);
  return { versions: [ctx.surface.apiVersion], at: () => head };
}
