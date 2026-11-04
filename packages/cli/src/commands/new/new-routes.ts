import { buildRouteMap } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import type { CommandRoutes } from '../../routes/command-routes.ts';
import { moduleNewCommand } from './module-new-command.ts';
import { newCommand } from './new.ts';

/** `new <kind> <reference>` and its alias `module new` (sections 16.9.7 and 16.9.8). */
export const newRoutes: CommandRoutes = {
  new: newCommand,
  module: buildRouteMap<string, CliContext>({
    routes: { new: moduleNewCommand },
    docs: { brief: 'Module commands.' },
  }),
};
