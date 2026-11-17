import type { ApiSurface, Artifact } from '@keelwerk/core';
import { buildGraphqlSchema } from '../schema/build-graphql-schema.ts';
import { graphqlSdlOf } from './graphql-sdl-of.ts';

/** The committed SDL of one API version of an app: `generated/graphql/<app>/<version>.graphql`, checked by `generate --check` like every generated file. */
export function sdlArtifact(surface: ApiSurface): Artifact {
  return {
    kind: 'file',
    path: `generated/graphql/${surface.app}/${surface.apiVersion}.graphql`,
    contentType: 'application/graphql',
    content: graphqlSdlOf(buildGraphqlSchema(surface)),
  };
}
