import type { TransportAdapter } from '@keelwerk/core';
import { checkGraphqlSurface } from './check/check-graphql-surface.ts';
import type { GraphqlConfig } from './graphql-config.ts';
import type { GraphqlStaticOptions } from './graphql-static-options.ts';
import { mountGraphql } from './mount/mount-graphql.ts';
import { sdlArtifact } from './sdl/sdl-artifact.ts';

/**
 * The GraphQL adapter (section 16.6): `check`, the GraphQL surface check, the committed SDL of each
 * API version as its artefact (`generated/graphql/<app>/<version>.graphql`), and `mount`, which builds the schema of every
 * API version at `listen` and registers one handler on the host under the path.
 */
export function createGraphqlAdapter(
  options: GraphqlStaticOptions = {},
): TransportAdapter<GraphqlStaticOptions, GraphqlConfig> {
  return {
    name: 'graphql',
    capabilities: { streaming: ['sse', 'websocket'], batching: true, binary: false },
    static: options,
    check: (surface) => checkGraphqlSurface(surface),
    artifacts: (surface) => [sdlArtifact(surface)],
    mount: (ctx) => mountGraphql(ctx, options),
  };
}
