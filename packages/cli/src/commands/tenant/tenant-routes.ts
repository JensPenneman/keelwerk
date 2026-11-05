import { buildRouteMap } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import type { CommandRoutes } from '../../routes/command-routes.ts';
import { tenantCreateCommand } from './create.ts';
import { tenantEnterCommand } from './enter.ts';
import { tenantListCommand } from './list.ts';

/** The `tenant` command group (section 16.9.7): `create`, `enter` and `list`, aliases of `call core.tenant...`. */
export const tenantRoutes: CommandRoutes = {
  tenant: buildRouteMap<string, CliContext>({
    routes: {
      create: tenantCreateCommand,
      enter: tenantEnterCommand,
      list: tenantListCommand,
    },
    docs: { brief: 'Create, enter and list tenants.' },
  }),
};
