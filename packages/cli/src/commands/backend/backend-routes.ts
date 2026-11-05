import { buildRouteMap } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import type { CommandRoutes } from '../../routes/command-routes.ts';
import { backendCreateCommand } from './create.ts';
import { backendListCommand } from './list.ts';

/** The `backend` command group (section 16.9.7): `create` and `list`, aliases of `call core.backend...`. */
export const backendRoutes: CommandRoutes = {
  backend: buildRouteMap<string, CliContext>({
    routes: { create: backendCreateCommand, list: backendListCommand },
    docs: { brief: 'Create and list backends.' },
  }),
};
