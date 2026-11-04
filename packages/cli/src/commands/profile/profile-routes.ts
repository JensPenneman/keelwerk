import { buildRouteMap } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import type { CommandRoutes } from '../../routes/command-routes.ts';
import { profileAddCommand } from './profile-add-command.ts';
import { profileListCommand } from './profile-list-command.ts';
import { profileRemoveCommand } from './profile-remove-command.ts';
import { profileShowCommand } from './profile-show-command.ts';
import { profileUseCommand } from './profile-use-command.ts';

/** `profile list|show|use|add|remove`: the profile file, without a connection (section 16.9.6). */
export const profileRoutes: CommandRoutes = {
  profile: buildRouteMap<string, CliContext>({
    routes: {
      list: profileListCommand,
      show: profileShowCommand,
      use: profileUseCommand,
      add: profileAddCommand,
      remove: profileRemoveCommand,
    },
    docs: { brief: 'Manage connection profiles.' },
  }),
};
