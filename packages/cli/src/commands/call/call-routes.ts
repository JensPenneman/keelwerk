import type { ApiSurface } from '@keelwerk/core';
import { buildActionRoutes } from '../../routes/build-action-routes.ts';
import type { CommandRoutes } from '../../routes/command-routes.ts';
import { callPlaceholder } from './call-placeholder.ts';

/** `call <reference>`: the action routes of the surface, or a placeholder until one is loaded (section 16.9.2). */
export function callRoutes(surface: ApiSurface | undefined): CommandRoutes {
  return { call: surface === undefined ? callPlaceholder : buildActionRoutes(surface) };
}
