import type { Artifact, MountContext, MountHandle, Scope } from '@keelwerk/core';
import { buildRouteTable } from './build-route-table.ts';
import { checkRestSurface } from './check/check-rest-surface.ts';
import { createRestHandler } from './create-rest-handler.ts';
import { inFlightHandler } from './in-flight-handler.ts';
import type { RestConfig } from './rest-config.ts';
import { restConfigOf } from './rest-config-of.ts';
import type { RestStaticOptions } from './rest-static-options.ts';

/**
 * Mounts the REST surface of one app on the host (section 16.3.2): refuses a surface the check
 * names a problem for, builds the route table of the app's surface and registers one handler
 * under the base path and one per host-root `rest.path`. The host strips the prefix it routed on;
 * the handler never does. The backend's configuration comes through `ctx.config`, which the
 * runtime reads from the control store.
 */
export async function mountSurface(
  ctx: MountContext<RestConfig>,
  options: RestStaticOptions,
  artifacts: () => readonly Artifact[],
): Promise<MountHandle> {
  const refused = checkRestSurface(ctx.surface, options)[0];
  if (refused !== undefined) {
    throw new TypeError(`${refused.code}: ${refused.subject}: ${refused.message}`);
  }
  const table = buildRouteTable(ctx.surface, options);
  const basePath = options.basePath ?? '/api';
  const deps = {
    app: ctx.app,
    deploymentId: ctx.deploymentId,
    surface: ctx.surface,
    invoker: ctx.invoker,
    table,
    options,
    config: (scope: Scope) => restConfigOf(ctx.config(scope)),
    artifacts: artifacts(),
    log: ctx.log,
    development: ctx.development === true,
  };
  const base = inFlightHandler(createRestHandler(deps), basePath);
  ctx.host.route({ app: ctx.app, transport: 'rest', prefix: basePath }, base.handler);
  // A host-root path is its own mount: its handler is told so, instead of guessing from the path.
  const root = inFlightHandler(createRestHandler({ ...deps, root: true }), basePath);
  for (const path of table.absolutePaths) {
    ctx.host.route({ app: ctx.app, transport: 'rest', prefix: path }, root.handler);
  }
  return {
    close: async (deadline) => {
      await Promise.all([base.handle.close(deadline), root.handle.close(deadline)]);
    },
  };
}
