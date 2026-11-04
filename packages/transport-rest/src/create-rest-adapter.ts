import type { ApiSurface, Artifact, TransportAdapter } from '@keelwerk/core';
import { buildRouteTable } from './build-route-table.ts';
import { checkRestSurface } from './check/check-rest-surface.ts';
import { createRestHandler } from './create-rest-handler.ts';
import { inFlightHandler } from './in-flight-handler.ts';
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
    async mount(ctx) {
      const refused = checkRestSurface(ctx.surface, fixed)[0];
      if (refused !== undefined) {
        throw new TypeError(`${refused.code}: ${refused.subject}: ${refused.message}`);
      }
      const table = buildRouteTable(ctx.surface, fixed);
      const basePath = fixed.basePath ?? '/api';
      const inner = createRestHandler({
        app: ctx.app,
        surface: ctx.surface,
        invoker: ctx.invoker,
        table,
        options: fixed,
        config: ctx.config,
        artifacts: artifacts(ctx.surface),
        log: ctx.log,
        development: ctx.development === true,
      });
      const { handler, handle } = inFlightHandler(inner, basePath);
      ctx.host.route({ app: ctx.app, transport: 'rest', prefix: basePath }, handler);
      for (const path of table.absolutePaths) {
        ctx.host.route({ app: ctx.app, transport: 'rest', prefix: path }, handler);
      }
      return handle;
    },
  };
}
