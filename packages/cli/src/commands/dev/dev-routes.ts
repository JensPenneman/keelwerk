import type { CommandRoutes } from '../../routes/command-routes.ts';
import { devCommand } from './dev.ts';

/** The `dev` command group (section 16.9.7): the watch loop of section 13.6. */
export const devRoutes: CommandRoutes = { dev: devCommand };
