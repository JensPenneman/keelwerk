import type { ApiSurface, Artifact, TransportAdapter } from '@keelwerk/core';
import { checkRestSurface } from './check/check-rest-surface.ts';
import { mountSurface } from './mount-surface.ts';
import { openapiArtifact } from './openapi/openapi-artifact.ts';
import type { RestConfig } from './rest-config.ts';
import type { RestStaticOptions } from './rest-static-options.ts';

/**
 * The REST adapter (section 16.5): `check`, the REST surface check, `artifacts` for the
 * emitters, and `mount`, which builds the route table of the app's surface at `listen` and
 * registers one handler on the host under the base path (and one per host-root `rest.path`).
 */
export function createRestAdapter(
  options: RestStaticOptions = {},
): TransportAdapter<RestStaticOptions, RestConfig> {
  const fixed: RestStaticOptions = { basePath: '/api', openapi: '3.1', ...options };
  // The security schemes come from `surface.resolvers`, which the surface derivation fills from the principal resolvers (section 8.5).
  const artifacts = (surface: ApiSurface): readonly Artifact[] => [
    openapiArtifact(surface, {
      ...(fixed.basePath === undefined ? {} : { basePath: fixed.basePath }),
      ...(fixed.openapi === undefined ? {} : { openapi: fixed.openapi }),
    }),
  ];
  return {
    name: 'rest',
    capabilities: { streaming: [], batching: false, binary: false },
    static: fixed,
    check: (surface) => checkRestSurface(surface, fixed),
    artifacts,
    mount: (ctx) => mountSurface(ctx, fixed, () => artifacts(ctx.surface)),
  };
}
