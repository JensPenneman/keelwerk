import type { Artifact } from '@keelwerk/core';
import type { OrpcStaticOptions } from './orpc-static-options.ts';

/**
 * The type fragment `keelwerk.generated.ts` receives (S-128): the typed oRPC client tree of the
 * app, in the wire form the module's serialiser option selects.
 */
export function orpcFragment(options: OrpcStaticOptions): Artifact {
  return {
    kind: 'type-fragment',
    module: '@keelwerk/transport-orpc',
    names: ['OrpcRouterOf'],
    content:
      options.serializer === 'json'
        ? "export type OrpcRouter = OrpcRouterOf<App, 'json'>"
        : 'export type OrpcRouter = OrpcRouterOf<App>',
  };
}
